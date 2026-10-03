import { Type, type Static } from "typebox";
import { GoalSchema, validate, validTime, type Goal } from "./contracts.ts";

const shortText = Type.String({ minLength: 1, maxLength: 1200 });
const notes = Type.Array(shortText, { maxItems: 8 });
// The child proposes educational scope, never permission, learner evidence or
// storage IDs. The existing Goal/Component/Plan ledger contracts stay unchanged.
export const PlannerDraftSchema = Type.Object({
  goal: Type.Object(Type.Omit(GoalSchema, ["mode", "objective", "provider_sharing", "source_ids", "learner_notes", "probe"]).properties, { additionalProperties: false }),
  probe: Type.Enum(["offer", "skip"]),
  summary: Type.String({ minLength: 1, maxLength: 600 }),
  components: Type.Array(Type.Object({ title: shortText, behavior: shortText, uncertainty: shortText }, { additionalProperties: false }), { maxItems: 3 }),
  outline: Type.Object({
    next_activities: Type.Array(shortText, { minItems: 1, maxItems: 4 }),
    known_gaps: notes,
    uncertain_assumptions: notes,
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type PlannerDraft = Static<typeof PlannerDraftSchema>;
export interface PlanningRequest {
  mode: Goal["mode"];
  objective: string;
  notes: string;
  context: Record<string, unknown>;
  now: string;
  reason: "intake" | "replan";
}
export interface PlanningCommit { draft: PlannerDraft; expected_goal_revision_id?: string }

export function validatePlannerDraft(value: unknown): asserts value is PlannerDraft {
  validate<PlannerDraft>(PlannerDraftSchema, value);
  if (value.goal.deadline) validTime(value.goal.deadline);
}

export function parsePlannerDraft(text: string): PlannerDraft {
  if (text.length > 24000) throw new Error("Planner output exceeds its bound");
  const normalized = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");
  const draft: unknown = JSON.parse(normalized);
  validatePlannerDraft(draft);
  return draft;
}
