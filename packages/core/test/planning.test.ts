import { expect, test } from "bun:test";
import { parsePlannerDraft } from "../src/planning.ts";
import { draft } from "./planning-fixture.ts";

test("planner proposals are strict, bounded and cannot grant consent or assign storage IDs", () => {
  expect(parsePlannerDraft(JSON.stringify(draft))).toEqual(draft);
  expect(parsePlannerDraft(`\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``)).toEqual(draft);
  for (const bad of [
    { ...draft, goal: { ...draft.goal, provider_sharing: true } },
    { ...draft, goal: { ...draft.goal, source_ids: ["private"] } },
    { ...draft, goal: { ...draft.goal, deadline: "not a date" } },
    { ...draft, components: Array(4).fill(draft.components[0]) },
    { ...draft, outline: { ...draft.outline, next_activities: [] } },
  ]) expect(() => parsePlannerDraft(JSON.stringify(bad))).toThrow();
  expect(() => parsePlannerDraft("x".repeat(24001))).toThrow("bound");
  expect(() => parsePlannerDraft(`Some preamble ${JSON.stringify(draft)}`)).toThrow();
});
