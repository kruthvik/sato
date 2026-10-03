import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runTutor, type TutorBridge } from "../../pi/src/tutor.ts";
import { installFixtures } from "../../activities/src/fixtures.ts";
import type { Goal, Revision, TaskDefinition } from "../../core/src/contracts.ts";
import { LearningService, requestLearning, startLearningServer } from "./service.ts";
import type { SatoPaths } from "./paths.ts";
import { commitPlannedGoal, commitDelegatedOutline, delegatedPlanResult } from "./planning.ts";

export async function sourceControl(service: LearningService, args: string, sessionId = "cli"): Promise<unknown> {
  const match = args.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const action = match?.[1] ?? "list";
  const target = (match?.[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
  if (action === "list") return service.sources.list();
  if (action === "add") {
    if (!target) throw new Error("Usage: source add PATH");
    const result = await service.sources.importFile(target);
    return { source_id: result.revision_id, status: result.status, duplicate: result.duplicate, title: result.body.title, next: `source preview ${result.revision_id}, then source accept ${result.revision_id}` };
  }
  if (!target) throw new Error("Source ID required");
  if (action === "preview") return service.sources.preview(target);
  if (action === "status") return service.sources.list().find(s => s.source_id === target) ?? { error: "Source not found" };
  if (action === "accept") { service.sources.accept(target); return { source_id: target, status: "indexed", next: `Use /source attach ${target} to select it for a tutoring goal` }; }
  if (action === "remove") { service.sources.remove(target); return { source_id: target, status: "removed", retained: "Original and historical evidence remain local for provenance; future use is blocked" }; }
  if (action === "attach") {
    const goal = service.store.currentGoal();
    if (!goal) throw new Error("Start /learn or /exam first");
    if (!goal.body.provider_sharing) throw new Error("Provider-sharing consent is required to attach a source");
    if (service.store.sourceStatus(target) !== "indexed") throw new Error("Preview and accept the source first");
    return service.store.define({ operation_id: randomUUID(), kind: "goal", entity_id: goal.entity_id, parent_revision_id: goal.revision_id, expected_goal_revision_id: goal.revision_id, body: { ...goal.body, source_ids: [...new Set([...goal.body.source_ids, target])] } }, "learner", sessionId);
  }
  throw new Error("Usage: source add PATH | list | preview ID | status ID | accept ID | attach ID | remove ID");
}

export async function launchTutor(paths: SatoPaths, service: LearningService): Promise<void> {
  const server = startLearningServer(service);
  const bridge: TutorBridge = {
    operation: (name, body, sessionId, signal) => requestLearning(server, name, body, sessionId, signal),
    async input(text, sessionId) { service.store.learnerResponse(text, sessionId); },
    async goal(body: Goal, sessionId, planning) {
      if (planning) return commitPlannedGoal(service.store, body, sessionId, planning);
      const previous = service.store.currentGoal();
      const goal = service.store.define({ operation_id: randomUUID(), kind: "goal", ...(previous ? { entity_id: previous.entity_id, parent_revision_id: previous.revision_id, expected_goal_revision_id: previous.revision_id } : {}), body }, "learner", sessionId) as unknown as Revision<Goal>;
      installFixtures(service.store, goal);
      return goal;
    },
    async plan(draft, sessionId, expectedGoalRevisionId, request) { return commitDelegatedOutline(service.store, draft, sessionId, expectedGoalRevisionId, request); },
    async planResult(request) { return delegatedPlanResult(service.store, request); },
    source: (args, sessionId) => sourceControl(service, args, sessionId),
    async approve(id, confirm) {
      const task = service.store.revision<TaskDefinition>(id, "task_definition");
      if (task.body.status !== "candidate" && task.body.status !== "needs_review") throw new Error("Only candidate tasks need approval");
      if (confirm) return service.approveTask(id, "Learner explicitly reviewed the task/key or public rubric with /approve confirm");
      if (task.body.answer) service.store.append("decision", { action: "task_solution_reviewed", task_entity_id: task.entity_id, reason: "Learner viewed candidate answer key", evidence_event_ids: [] }, randomUUID(), "learner", "review");
      return { review_required: true, task_revision_id: id, prompt: task.body.prompt, rubric: service.store.revision(task.body.rubric_revision_id).body, answer: task.body.answer ?? "Open-ended task: inspect public rubric", instruction: "Review these criteria/key, then use /approve ID confirm to approve. Viewing a key makes this item supported evidence." };
    },
    calls: async (body, sessionId) => { await requestLearning(server, "telemetry", body, sessionId); },
    async stop(sessionId) {
      const goal = service.store.currentGoal();
      if (!goal) return { stopped: true, message: "No active goal" };
      const context = await service.context({}, sessionId);
      const previous = context.checkpoint as { payload?: { summary?: string; next_action?: string; gaps?: string[] } } | null;
      return service.store.record({ operation_id: randomUUID(), kind: "checkpoint", expected_goal_revision_id: goal.revision_id, payload: { goal_revision_id: goal.revision_id, summary: previous?.payload?.summary ?? "Stopped at learner request; inspect recorded task and evidence when resuming", next_action: previous?.payload?.next_action ?? "Resume the current component with a fresh independent task or change the goal", gaps: previous?.payload?.gaps ?? ["Current ability is unverified until the next independent observation"], stopped: true } }, sessionId);
    },
    async shutdown() { server.stop(); },
  };
  const release = () => { server.stop(); service.close(); };
  process.once("exit", release);
  try { await runTutor(paths, bridge); }
  finally { process.off("exit", release); server.stop(); }
}

export async function readBrain(paths: SatoPaths): Promise<string> { return readFile(paths.brain, "utf8"); }
