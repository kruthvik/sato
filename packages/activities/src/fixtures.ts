import { randomUUID } from "node:crypto";
import type { Goal, Revision, TaskDefinition } from "../../core/src/contracts.ts";
import { canonical, type LearningStore } from "../../storage/src/store.ts";

const fixtures = {
  math: { title: "Preserve equality", behavior: "Solve a linear equation while preserving equality", construct: "Undo multiplication and addition on both sides", concept: "Equivalence", dimensions: [{ name: "answer", criterion: "The value satisfies the original equation", max_score: 1 }], tasks: [
    { prompt: "Solve 3x + 5 = 20. Respond with only the numerical value of x.", answer: "5", scoring: "numeric" },
    { prompt: "Solve 4x - 7 = 21. Respond with only the numerical value of x.", answer: "7", scoring: "numeric" },
    { prompt: "A hire costs 6 dollars plus 2 dollars per hour. Your bill is 24 dollars. How many hours did you hire it for? Respond with only the number of hours.", answer: "9", scoring: "numeric" },
  ] },
  writing: { title: "Support a claim", behavior: "Connect a claim to evidence with an explicit warrant", construct: "Claim–evidence–warrant argument", concept: "Warrant", dimensions: [
    { name: "claim", criterion: "A clear, defensible claim addressing the prompt", max_score: 2 },
    { name: "evidence", criterion: "Uses the given evidence accurately without inventing facts", max_score: 2 },
    { name: "warrant", criterion: "Explains why the evidence supports the claim and acknowledges a limit", max_score: 2 },
  ], tasks: [
    { prompt: "A school reports that library visits increased after opening later, but it did not measure grades. Write three sentences arguing whether later opening should continue. Use the evidence and state one limit.", scoring: "rubric" },
    { prompt: "A town adds a cycle lane. Cycle counts rise, while accident data are unavailable. Write a short evidence-backed argument about continuing the lane, including what cannot yet be concluded.", scoring: "rubric" },
  ] },
  science: { title: "Explain conservation", behavior: "Use conservation of mass to explain changes in an open or closed system", construct: "System boundaries and conservation of mass", concept: "Conservation of mass", dimensions: [
    { name: "mechanism", criterion: "Explains that matter is conserved and accounts for gaseous products", max_score: 2 },
    { name: "boundary", criterion: "Distinguishes what can cross an open versus closed system boundary", max_score: 2 },
    { name: "prediction", criterion: "Predicts measured mass under the stated conditions with reasoning", max_score: 2 },
  ], tasks: [
    { prompt: "Vinegar reacts with baking soda in an open cup and produces gas. The measured mass decreases. Does this violate conservation of mass? Explain where the matter went and predict what a sealed container would show.", scoring: "rubric" },
    { prompt: "A sealed flask containing a plant gains oxygen in its gas mixture during photosynthesis. Predict whether the total mass of the sealed flask changes, and explain your system boundary.", scoring: "rubric" },
  ] },
} as const;

/** Curated offline fixtures exercise domain behavior; they are not a calibrated assessment bank. */
export function installFixtures(store: LearningStore, goal: Revision<Goal>): Revision<TaskDefinition>[] {
  if (!(goal.body.subject in fixtures)) return [];
  const fixture = fixtures[goal.body.subject as keyof typeof fixtures];
  const existing = [...new Map(store.revisions("task_definition").filter(r => r.body.title === fixture.title).map(r => [r.entity_id, r])).values()].filter(r => r.body.status === "practice_ready");
  if (existing.length) return existing.map(r => {
    if (canonical(r.body.allowed_aids) === canonical(goal.body.allowed_aids)) return r;
    return store.define({ operation_id: randomUUID(), kind: "task_definition", entity_id: r.entity_id, parent_revision_id: r.revision_id, expected_goal_revision_id: goal.revision_id, body: { ...r.body, allowed_aids: goal.body.allowed_aids } }, "curated_fixture");
  }) as unknown as Revision<TaskDefinition>[];
  const define = (kind: string, body: unknown) => store.define({ operation_id: randomUUID(), kind, expected_goal_revision_id: goal.revision_id, body }, "curated_fixture");
  const concept = define("concept", { title: fixture.concept, description: fixture.construct });
  const component = define("component", { title: fixture.title, behavior: fixture.behavior, subject: goal.body.subject, concept_revision_ids: [concept.revision_id], prerequisite_revision_ids: [], uncertainty: "Narrow fixture; no inference about other components" });
  const rubric = define("rubric", { title: fixture.title, dimensions: fixture.dimensions, provisional: false, source_span_ids: [] });
  const family = define("task_family", { title: fixture.title, construct: fixture.construct, variation: "Change values and context; preserve the relation being assessed", lineage_revision_ids: [] });
  return fixture.tasks.map((task, index) => define("task_definition", { ...task, title: fixture.title, family_revision_id: family.revision_id, component_revision_ids: [component.revision_id], rubric_revision_id: rubric.revision_id, source_span_ids: [], format: goal.body.subject === "math" ? "solve" : "explain", allowed_aids: goal.body.allowed_aids, steps: [], status: "practice_ready", review: { method: "curated", reason: "Bundled narrow fixture, manually specified key or public criteria" }, stakes: "low", partition: "practice", changes: index === 0 ? [] : [index === 2 ? "application context" : "new values or scenario"], uncertainty: "Known family; not a disjoint transfer test or validated mastery measure" }) as unknown as Revision<TaskDefinition>);
}
