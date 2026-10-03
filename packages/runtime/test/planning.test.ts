import { afterEach, expect, test } from "bun:test";
import { LearningStore } from "../../storage/src/store.ts";
import { draft } from "../../core/test/planning-fixture.ts";
import { commitPlannedGoal, commitDelegatedOutline, delegatedPlanResult } from "../src/planning.ts";
const stores: LearningStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
function setup() {
  const store = new LearningStore(":memory:"); stores.push(store);
  const body = { ...draft.goal, mode: "learn" as const, objective: "Learn Python", probe: draft.probe, provider_sharing: true, source_ids: [] };
  return { store, body };
}

test("delegated intake atomically saves the existing goal, component and outline contracts", () => {
  const { store, body } = setup();
  const { goal, outline } = commitPlannedGoal(store, body, "conversation", { draft });
  expect(goal.body.objective).toBe("Learn Python");
  expect(outline.body.goal_revision_id).toBe(goal.revision_id);
  expect((outline.body.component_revision_ids as string[]).map(id => store.revision(id).body.behavior)).toEqual([draft.components[0]!.behavior]);
  expect(store.integrity()).toEqual(["ok"]);
  const seq = store.throughSeq;
  expect(() => commitPlannedGoal(store, body, "conversation", { draft })).toThrow("changed");
  expect(store.throughSeq).toBe(seq);
  const invalid = { ...draft, outline: { ...draft.outline, next_activities: [] } };
  expect(() => commitPlannedGoal(store, body, "conversation", { draft: invalid, expected_goal_revision_id: goal.revision_id })).toThrow();
  expect(store.currentGoal()!.revision_id).toBe(goal.revision_id);
});

test("replans reject stale goals and retry stable operation IDs without new evidence or revisions", () => {
  const { store, body } = setup();
  const { goal, outline } = commitPlannedGoal(store, body, "conversation", { draft });
  const request = { operation_id: "replan-1", kind: "plan", expected_goal_revision_id: goal.revision_id, body: { goal_revision_id: goal.revision_id, component_revision_ids: [], ...draft.outline } };
  expect(delegatedPlanResult(store, request)).toBeUndefined();
  const first = commitDelegatedOutline(store, draft, "conversation", goal.revision_id, request);
  expect(first.revision_id).toBe(outline.revision_id);
  const seq = store.throughSeq;
  expect(delegatedPlanResult(store, request)?.revision_id).toBe(first.revision_id);
  expect(commitDelegatedOutline(store, draft, "conversation", goal.revision_id, request).revision_id).toBe(first.revision_id);
  expect(store.throughSeq).toBe(seq);
  expect(() => delegatedPlanResult(store, { ...request, body: { ...request.body, next_activities: ["Different request"] } })).toThrow("reused");
  const changed = { ...draft, outline: { ...draft.outline, next_activities: ["Try one conditional"] } };
  const second = commitDelegatedOutline(store, changed, "conversation", goal.revision_id);
  expect(second.parent_revision_id).toBe(first.revision_id);
  expect(() => commitDelegatedOutline(store, draft, "conversation", "old-goal")).toThrow("changed");
  expect(store.events().filter(e => e.kind === "assessment" || e.kind === "attempt_submitted")).toEqual([]);
});

test("an outline persistence failure rolls back goal, fixtures and components together", () => {
  const { store, body } = setup();
  const define = store.define.bind(store);
  store.define = (input, actor, sessionId) => {
    if ((input as { kind: string }).kind === "plan") throw new Error("Simulated outline save failure");
    return define(input, actor, sessionId);
  };
  expect(() => commitPlannedGoal(store, body, "conversation", { draft })).toThrow("save failure");
  expect(store.currentGoal()).toBeUndefined();
  expect(store.revisions()).toEqual([]);
  expect(store.events()).toEqual([]);
  expect(store.integrity()).toEqual(["ok"]);
});
