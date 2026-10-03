import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionToolContext, RegisteredCommand, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createTutorExtension, createTutorRuntime, type TutorBridge } from "../src/tutor.ts";
import { createSatoPaths } from "../../runtime/src/paths.ts";
import { bootstrapSatoHome } from "../../runtime/src/bootstrap.ts";
import type { CallEntry } from "../../core/src/contracts.ts";
import { draft } from "../../core/test/planning-fixture.ts";
import type { PlanningRequest } from "../../core/src/planning.ts";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function bridge(calls: CallEntry[] = []): TutorBridge {
  return { operation: async () => ({ goal: null }), input: async () => {}, goal: async () => ({}), source: async () => [], approve: async () => ({}), calls: async entry => { calls.push(entry); }, stop: async () => ({}), shutdown: async () => {} };
}

test("bundled Pi SDK loads the native tutor, isolated policy and four educational tools without model calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "sato-native-")); roots.push(root);
  const paths = createSatoPaths({ home: join(root, "home") }); await bootstrapSatoHome(paths);
  const calls: CallEntry[] = [];
  const runtime = await createTutorRuntime(paths, bridge(calls));
  try {
    expect(runtime.session.getActiveToolNames().sort()).toEqual(["learning_context", "learning_define", "learning_record", "learning_source"]);
    expect(runtime.services.resourceLoader.getExtensions().errors).toEqual([]);
    expect(runtime.services.resourceLoader.getSystemPrompt()).toContain("learner's personal tutor");
    expect(runtime.services.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
    expect(runtime.services.settingsManager.getEnableInstallTelemetry()).toBe(false);
    expect(calls).toEqual([]);
  } finally { await runtime.dispose(); }
});

test("extension telemetry records actual hook starts/HTTP failures and explicitly unknown stream completion", async () => {
  const calls: CallEntry[] = [];
  const handlers = new Map<string, (event: unknown, context: unknown) => Promise<unknown>>();
  const commands: string[] = [];
  const api = { registerTool() {}, registerCommand(name: string) { commands.push(name); }, on(name: string, handler: (event: unknown, context: unknown) => Promise<unknown>) { handlers.set(name, handler); return () => {}; } };
  await createTutorExtension(bridge(calls))(api as unknown as ExtensionAPI);
  const ctx = { model: { provider: "fixture", id: "fixture" }, sessionManager: { getSessionId: () => "session" }, ui: { notify() {} } };
  await handlers.get("before_provider_request")!({ payload: { prompt: "private" } }, ctx);
  await handlers.get("after_provider_response")!({ status: 500 }, ctx);
  await handlers.get("before_provider_request")!({ payload: { prompt: "retry" } }, ctx);
  await handlers.get("after_provider_response")!({ status: 200 }, ctx);
  await handlers.get("agent_end")!({}, ctx);
  expect(calls.map(c => c.phase)).toEqual(["started", "failed", "started", "response", "unknown"]);
  expect(calls[0]!.request_hash).toHaveLength(64);
  expect(JSON.stringify(calls)).not.toContain('"private"');
  expect(commands).toContain("learn"); expect(commands).toContain("exam"); expect(commands).not.toContain("drill");
  expect(await handlers.get("input")!({ source: "interactive", text: "Start a model request without consent" }, ctx)).toEqual({ action: "handled" });
});

async function intakeHarness({ consent = true, answers = ["Learn Python", ""], fail = false }: { consent?: boolean; answers?: Array<string | undefined>; fail?: boolean } = {}) {
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, ToolDefinition>();
  const questions: string[] = [], sent: string[] = [], notices: string[] = [];
  const requests: PlanningRequest[] = [], saved: unknown[] = [];
  let cached: unknown;
  let packet: unknown = { goal: null };
  const api = { registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); }, registerCommand(name: string, command: RegisteredCommand) { commands.set(name, command); }, on() { return () => {}; }, sendUserMessage(text: string) { sent.push(text); } };
  const base = bridge();
  await createTutorExtension({ ...base,
    operation: async () => packet,
    goal: async (body, _sid, planning) => { saved.push({ body, planning }); return {}; },
    planResult: async () => cached,
    plan: async () => { cached = { revision_id: "delegated-outline" }; return cached; },
  }, { planner: async (request, _ctx, signal) => { requests.push(request); signal.throwIfAborted(); if (fail) throw new Error("Offline planner failure"); return draft; } })(api as unknown as ExtensionAPI);
  const ctx = { model: { provider: "fixture", id: "fixture" }, mode: "print", hasUI: false, isIdle: () => true, abort() {}, sessionManager: { getSessionId: () => "parent" },
    ui: { input: async (title: string) => { questions.push(title); return answers.shift(); }, confirm: async (title: string) => { questions.push(title); return consent; }, notify: (text: string) => { notices.push(text); }, setStatus() {} },
  } as unknown as ExtensionCommandContext & ExtensionToolContext;
  return { commands, tools, ctx, requests, saved, questions, sent, notices, setPacket: (value: unknown) => { packet = value; } };
}

test("simple opening asks goal and one optional note, infers subject through the child, then starts teaching", async () => {
  const h = await intakeHarness();
  await h.commands.get("learn")!.handler("", h.ctx);
  expect(h.questions).toEqual(["What would you like to learn?", "Anything I should know? (time, deadline, or how you'd like to learn — blank is fine)", "Use your model?"]);
  expect(h.requests).toHaveLength(1);
  expect(h.requests[0]!.objective).toBe("Learn Python");
  expect(h.requests[0]!.reason).toBe("intake");
  expect(h.saved).toHaveLength(1);
  expect(h.saved[0]).toMatchObject({ body: { subject: "computing", provider_sharing: true, source_ids: [] }, planning: { draft } });
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]).toContain("Do not repeat intake");
  expect(h.questions.some(question => question.toLowerCase().includes("subject"))).toBe(false);
});

test("exam objective skips the goal prompt; declining consent, cancellation and planner failure save nothing", async () => {
  const exam = await intakeHarness({ answers: ["Interview tomorrow; 20 minutes"] });
  await exam.commands.get("exam")!.handler("Python interview", exam.ctx);
  expect(exam.questions).toHaveLength(2);
  expect(exam.requests[0]).toMatchObject({ objective: "Python interview", mode: "exam", notes: "Interview tomorrow; 20 minutes" });
  for (const h of [await intakeHarness({ consent: false }), await intakeHarness({ answers: [undefined] }), await intakeHarness({ fail: true })]) {
    await h.commands.get("learn")!.handler("", h.ctx);
    expect(h.saved).toEqual([]); expect(h.sent).toEqual([]);
  }
  const denied = await intakeHarness({ consent: false });
  await denied.commands.get("learn")!.handler("", denied.ctx);
  expect(denied.requests).toEqual([]);
});

test("tutor plan tool delegates consequential replanning and reuses completed operation receipts", async () => {
  const h = await intakeHarness();
  h.setPacket({ goal: { revision_id: "goal-1", body: { ...draft.goal, mode: "learn", objective: "Learn Python", provider_sharing: true } } });
  const tool = h.tools.get("learning_define")!;
  const proposal = { operation_id: "plan-1", kind: "plan", expected_goal_revision_id: "goal-1", body: { goal_revision_id: "goal-1", component_revision_ids: [], ...draft.outline } };
  const first = await tool.execute("call-1", proposal, new AbortController().signal, undefined, h.ctx);
  const second = await tool.execute("call-2", proposal, new AbortController().signal, undefined, h.ctx);
  expect(second).toEqual(first);
  expect(h.requests).toHaveLength(1);
  expect(h.requests[0]!.reason).toBe("replan");
  const stale = await intakeHarness(); stale.setPacket({ goal: { revision_id: "new-goal", body: { provider_sharing: true } } });
  await expect(stale.tools.get("learning_define")!.execute("stale", proposal, new AbortController().signal, undefined, stale.ctx)).rejects.toThrow("changed");
  expect(stale.requests).toEqual([]);
});
