import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planWithPi } from "../src/planner.ts";
import { loadPi } from "../src/sdk.ts";
import { createSatoPaths } from "../../runtime/src/paths.ts";
import { bootstrapSatoHome } from "../../runtime/src/bootstrap.ts";
import { draft } from "../../core/test/planning-fixture.ts";
import type { CallEntry } from "../../core/src/contracts.ts";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("actual Pi child plans with one offline provider call, isolated resources and terminal telemetry", async () => {
  const root = await mkdtemp(join(tmpdir(), "sato-planner-")); roots.push(root);
  const paths = createSatoPaths({ home: join(root, "home") }); await bootstrapSatoHome(paths);
  const sdk = await loadPi(paths);
  const ai = await import(import.meta.resolve("@earendil-works/pi-ai", fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(paths.agent, "auth.json"), modelsPath: null, modelsStorePath: join(root, "catalog.json"), refreshOnCreate: false, allowModelNetwork: false });
  let count = 0;
  let output = JSON.stringify(draft);
  let waitForCancel = false;
  let useToolCall = false;
  modelRuntime.registerProvider("sato-offline-test", {
    api: "sato-offline-test-api", baseUrl: "https://example.invalid", apiKey: "offline",
    models: [{ id: "planner", name: "Offline planner", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2000 }],
    streamSimple(model, context, options) {
      count++;
      const system = context.messages.filter(message => message.role === "system");
      expect(system.flatMap(message => message.role === "system" ? message.toolsAdded ?? [] : [])).toEqual([]);
      expect(options?.maxTokens).toBe(4096);
      expect(JSON.stringify(system)).toContain("planning subagent");
      expect(JSON.stringify(system)).not.toContain("UNAUTHORIZED_CONTEXT");
      const stream = ai.createAssistantMessageEventStream();
      void (async () => {
        await options?.onPayload?.({ offline: true }, model);
        await options?.onResponse?.({ status: 200, headers: {} }, model);
        if (waitForCancel && !options?.signal?.aborted) await new Promise<void>(resolve => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
        const message = { role: "assistant", content: useToolCall ? [{ type: "toolCall", id: "unwanted", name: "not_allowed", arguments: {} }] : [{ type: "text", text: output }], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: options?.signal?.aborted ? "aborted" : useToolCall ? "toolUse" : "stop", timestamp: Date.now() };
        stream.push({ type: "start", partial: message });
        stream.push(options?.signal?.aborted ? { type: "error", reason: "aborted", error: message } : { type: "done", reason: message.stopReason, message }); stream.end();
      })();
      return stream;
    },
  });
  // A neighboring project instruction is not inherited by the child.
  await mkdir(paths.config, { recursive: true });
  await writeFile(join(paths.config, "AGENTS.md"), "UNAUTHORIZED_CONTEXT");
  await writeFile(join(paths.userResources.extensions, "must-not-load.ts"), 'throw new Error("User extension must not execute in planner");');
  const calls: CallEntry[] = [];
  const options = { sdk, modelRuntime, model: modelRuntime.getModel("sato-offline-test", "planner")!, sessionId: "parent", calls: async (entry: CallEntry) => { calls.push(entry); }, signal: new AbortController().signal };
  const request = { mode: "learn" as const, objective: "Learn Python", notes: "", context: {}, now: new Date().toISOString(), reason: "intake" as const };
  expect(await planWithPi(paths, request, options)).toEqual(draft);
  expect(count).toBe(1);
  expect(calls.map(call => call.phase)).toEqual(["started", "response", "completed"]);
  expect(calls[2]!.output_tokens).toBe(2);
  expect(calls[0]!.operation).toBe("pi_planner_request");
  output = "Not valid JSON";
  await expect(planWithPi(paths, request, options)).rejects.toThrow();
  expect(count).toBe(2); // one per independent planning session, never a repair loop
  const cancelled = new AbortController(); cancelled.abort(new Error("Cancelled"));
  await expect(planWithPi(paths, request, { ...options, signal: cancelled.signal })).rejects.toThrow("Cancelled");
  expect(count).toBe(2);
  waitForCancel = true;
  await expect(planWithPi(paths, request, { ...options, timeoutMs: 150 })).rejects.toThrow("too long");
  expect(count).toBe(3);
  expect(calls.at(-1)!.phase).toBe("cancelled");
  waitForCancel = false; useToolCall = true;
  await expect(planWithPi(paths, request, options)).rejects.toThrow("complete text");
  expect(count).toBe(4); // a tool-call loop cannot forward a second request
});
