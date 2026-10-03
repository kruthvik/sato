import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CallSchema, ContextSchema, DefineSchema, RecordSchema, SourceSchema, validate, type TaskDefinition } from "../../core/src/contracts.ts";
import { LearningStore } from "../../storage/src/store.ts";
import { SourceService } from "../../sources/src/service.ts";
import { compileContext, publicRevision } from "./context.ts";
import type { SatoPaths } from "./paths.ts";

export class LearningService {
  readonly store: LearningStore;
  readonly sources: SourceService;
  constructor(readonly paths: SatoPaths) {
    this.store = new LearningStore(join(paths.data, "learning.sqlite"));
    this.sources = new SourceService(this.store, join(paths.data, "blobs"));
  }
  async context(input: unknown, sessionId: string): Promise<Record<string, unknown>> {
    const brain = await readFile(this.paths.brain, "utf8").catch(() => "");
    return compileContext(this.store, input, brain, sessionId);
  }
  approveTask(revisionId: string, reason: string): Record<string, unknown> {
    const task = this.store.revision<TaskDefinition>(revisionId, "task_definition");
    const approved = this.store.define({ operation_id: randomUUID(), kind: "task_definition", entity_id: task.entity_id, parent_revision_id: task.revision_id, expected_goal_revision_id: this.store.currentGoal()?.revision_id, body: { ...task.body, status: "practice_ready", review: { method: "human", reason } } }, "learner");
    return publicRevision(approved) as unknown as Record<string, unknown>;
  }
  async operation(name: string, body: unknown, sessionId: string): Promise<unknown> {
    switch (name) {
      case "learning_context": return this.context(body, sessionId);
      case "learning_define": return publicRevision(this.store.define(body, "pi", sessionId));
      case "learning_record": return this.store.record(body, sessionId);
      case "learning_source": {
        validate<{ action: string; source_id?: string; query?: string }>(SourceSchema, body);
        const goal = this.store.currentGoal();
        const allowed = goal?.body.provider_sharing ? goal.body.source_ids : [];
        if (body.action === "list") return this.sources.list().filter(s => allowed.includes(s.source_id as string));
        if (body.action === "search") return this.sources.search(body.query ?? "", allowed);
        if (!body.source_id || !allowed.includes(body.source_id)) throw new Error("Source was not selected for provider sharing in this goal");
        return this.sources.list().find(s => s.source_id === body.source_id);
      }
      default: throw new Error("Unknown educational operation");
    }
  }
  close(): void { this.store.close(); }
}

/** Random per-launch capabilities never appear in model tools or learner tables. */
export function startLearningServer(service: LearningService) {
  const token = randomBytes(32).toString("hex");
  const telemetryToken = randomBytes(32).toString("hex");
  const schemas: Record<string, unknown> = { learning_context: ContextSchema, learning_define: DefineSchema, learning_record: RecordSchema, learning_source: SourceSchema };
  const matches = (request: Request, expected: string) => {
    const received = request.headers.get("authorization") ?? "";
    const target = `Bearer ${expected}`;
    return received.length === target.length && timingSafeEqual(Buffer.from(received), Buffer.from(target));
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 128 * 1024,
    async fetch(request) {
      if (request.headers.has("origin") || request.method !== "POST") return new Response("Forbidden", { status: 403 });
      const path = new URL(request.url).pathname.slice(1);
      if (!matches(request, path === "telemetry" ? telemetryToken : token)) return new Response("Unauthorized", { status: 401 });
      try {
        const input = await request.json() as { session_id?: string; body?: unknown };
        if (typeof input.session_id !== "string" || !input.session_id || input.session_id.length > 180) throw new Error("Missing session identity");
        if (path === "telemetry") { validate(CallSchema, input.body); service.store.logCall(input.body); return Response.json({ ok: true }); }
        if (!(path in schemas)) return new Response("Not found", { status: 404 });
        return Response.json(await service.operation(path, input.body, input.session_id));
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Operation failed" }, { status: 400 }); }
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, token, telemetryToken, stop: () => server.stop(true) };
}
export type LearningConnection = Pick<ReturnType<typeof startLearningServer>, "url" | "token" | "telemetryToken">;
export async function requestLearning(connection: LearningConnection, name: string, body: unknown, sessionId: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${connection.url}/${name}`, { method: "POST", headers: { authorization: `Bearer ${name === "telemetry" ? connection.telemetryToken : connection.token}`, "content-type": "application/json" }, body: JSON.stringify({ session_id: sessionId, body }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? `Learning service unavailable (${response.status}); stop evidence-bearing work and retry`);
  return result;
}
