import { randomUUID } from "node:crypto";
import { validatePlannerDraft, type PlanningCommit, type PlannerDraft } from "../../core/src/planning.ts";
import type { Goal, Revision } from "../../core/src/contracts.ts";
import { LearningStore, canonical, hash } from "../../storage/src/store.ts";
import { DefineSchema, validate } from "../../core/src/contracts.ts";
import { installFixtures } from "../../activities/src/fixtures.ts";

function saveOutline(store: LearningStore, goal: Revision<Goal>, draft: PlannerDraft, sessionId: string) {
  const componentIds = draft.components.map(component => {
    const body = { ...component, subject: goal.body.subject, concept_revision_ids: [], prerequisite_revision_ids: [] };
    const existing = store.revisions("component").find(revision => canonical(revision.body) === canonical(body));
    return existing?.revision_id ?? (store.define({ operation_id: randomUUID(), kind: "component", expected_goal_revision_id: goal.revision_id, body }, "pi", sessionId) as Revision).revision_id;
  });
  const body = { goal_revision_id: goal.revision_id, component_revision_ids: componentIds, ...draft.outline };
  const previous = store.revisions("plan").filter(revision => revision.body.goal_revision_id === goal.revision_id).at(-1);
  if (previous && canonical(previous.body) === canonical(body)) return previous;
  return store.define({ operation_id: randomUUID(), kind: "plan", expected_goal_revision_id: goal.revision_id,
    ...(previous ? { entity_id: previous.entity_id, parent_revision_id: previous.revision_id } : {}), body,
  }, "pi", sessionId);
}

export function commitPlannedGoal(store: LearningStore, body: Goal, sessionId: string, planning: PlanningCommit) {
  validatePlannerDraft(planning.draft);
  return store.db.transaction(() => {
    const previous = store.currentGoal();
    if (previous?.revision_id !== planning.expected_goal_revision_id) throw new Error("Goal changed while planning; start again with the current goal");
    const goal = store.define({ operation_id: randomUUID(), kind: "goal", ...(previous ? { entity_id: previous.entity_id, parent_revision_id: previous.revision_id, expected_goal_revision_id: previous.revision_id } : {}), body }, "learner", sessionId) as unknown as Revision<Goal>;
    installFixtures(store, goal);
    const outline = saveOutline(store, goal, planning.draft, sessionId);
    return { goal, outline };
  })();
}

type PlanRequest = { operation_id: string; kind: "plan"; expected_goal_revision_id: string; body: { goal_revision_id: string } };
export function delegatedPlanResult(store: LearningStore, request: unknown): Revision | undefined {
  validate<PlanRequest>(DefineSchema, request);
  if (request.kind !== "plan") throw new Error("A delegated plan request is required");
  const receipt = store.events().find(event => event.operation_id === `delegated-plan:${request.operation_id}`);
  if (!receipt) return;
  if (receipt.actor !== "host" || receipt.payload.action !== "delegated_plan" || receipt.payload.request_hash !== hash(canonical(request))) throw new Error("Planning operation ID was reused with different content");
  return store.revision(receipt.payload.plan_revision_id as string, "plan");
}

export function commitDelegatedOutline(store: LearningStore, draft: PlannerDraft, sessionId: string, expectedGoalRevisionId: string, request?: unknown) {
  validatePlannerDraft(draft);
  return store.db.transaction(() => {
    if (request) {
      const cached = delegatedPlanResult(store, request);
      if (cached) return cached;
      const input = request as PlanRequest;
      if (input.expected_goal_revision_id !== expectedGoalRevisionId || input.body.goal_revision_id !== expectedGoalRevisionId) throw new Error("Plan request does not match the current goal");
    }
    const goal = store.currentGoal();
    if (!goal || goal.revision_id !== expectedGoalRevisionId) throw new Error("Goal changed while planning; request a fresh plan");
    const outline = saveOutline(store, goal, draft, sessionId);
    if (request) store.append("decision", { action: "delegated_plan", request_hash: hash(canonical(request)), plan_revision_id: outline.revision_id, reason: "Accepted bounded subagent outline", evidence_event_ids: [] }, `delegated-plan:${(request as PlanRequest).operation_id}`, "host", sessionId);
    return outline;
  })();
}
