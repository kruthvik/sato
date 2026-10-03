import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Goal, Revision, TaskDefinition } from "../../core/src/contracts.ts";
import { LearningStore } from "../../storage/src/store.ts";
import { projectComponents } from "../../storage/src/projection.ts";
import { installFixtures } from "./fixtures.ts";

export async function runOfflineDemo(answers?: string[]): Promise<{ correct: number; attempts: number }> {
  if (answers && (answers.length !== 3 || answers.includes("/hint"))) throw new Error("Provide three comma-separated demo answers; hints require interactive mode");
  const store = new LearningStore(":memory:");
  const sessionId = `demo:${randomUUID()}`;
  const reader = answers ? undefined : createInterface({ input: stdin, output: stdout });
  const goal = store.define({ operation_id: randomUUID(), kind: "goal", body: { mode: "learn", objective: "Solve linear equations and interpret them in context", subject: "math", horizon_days: 30, target_format: "independent numerical response", criteria: ["Preserve equality"], allowed_aids: [], constraints: [], probe: "skip", provider_sharing: false, source_ids: [] } }, "learner", sessionId) as unknown as Revision<Goal>;
  const tasks = installFixtures(store, goal);
  console.log("Sato · offline learning demo\nNo provider calls. Demo records are temporary and separate from your learning history.\n\nTo preserve equality, undo each operation on both sides. For 2x + 4 = 12, subtract 4, then divide by 2: x = 4.\nTry these fresh tasks. Type /hint for help or /stop to end. Your budget never forces a stop.\n");
  let count = 0, correct = 0;
  try {
    for (const [index, task] of tasks.entries()) {
      const instance = store.define({ operation_id: randomUUID(), kind: "task_instance", expected_goal_revision_id: goal.revision_id, body: { definition_revision_id: task.revision_id, goal_revision_id: goal.revision_id, purpose: index === 2 ? "application" : "independent", conditions: ["no aids", "numerical answer only"] } }, "curated_fixture", sessionId);
      console.log((task.body as TaskDefinition).prompt);
      let response = answers?.[index] ?? await reader!.question("> ");
      if (response === "/stop") break;
      if (response === "/hint") {
        const hint = index === 2 ? "Subtract the fixed hire charge, then divide by the hourly rate." : "First undo the constant term; then divide both sides by the coefficient of x.";
        store.record({ operation_id: randomUUID(), kind: "assistance", expected_goal_revision_id: goal.revision_id, payload: { assistance_id: randomUUID(), instance_revision_id: instance.revision_id, component_revision_ids: task.body.component_revision_ids, stage: "exposed", kind: "hint", content: hint, answer_bearing: true } }, sessionId);
        console.log(hint);
        response = await reader!.question("> ");
        if (response === "/stop") break;
      }
      const learnerResponse = store.learnerResponse(response, sessionId);
      const attemptId = randomUUID();
      store.record({ operation_id: randomUUID(), kind: "attempt_submitted", expected_goal_revision_id: goal.revision_id, payload: { attempt_id: attemptId, instance_revision_id: instance.revision_id, response_event_id: learnerResponse.event_id, declared_aids: [] } }, sessionId);
      const assessment = store.record({ operation_id: randomUUID(), kind: "assessment", expected_goal_revision_id: goal.revision_id, payload: { attempt_id: attemptId, rubric_revision_id: task.body.rubric_revision_id, outcome: "not_observed", scores: [], feedback: "Check the value in the original equation.", uncertainty: "Numeric match does not assess reasoning" } }, sessionId);
      count++;
      if (assessment.payload.outcome === "success") { correct++; console.log("The value checks out.\n"); }
      else console.log(`The expected value is ${task.body.answer}. Undo the addition/subtraction, then divide; substitute your value to check. This correction is feedback, not independent success.\n`);
    }
    const views = projectComponents(store, store.throughSeq, store.now());
    console.log(`Checkpoint: ${correct}/${count} numerical matches. ${views[0]?.independent.length ?? 0} independent observations; ${views[0]?.supported.length ?? 0} supported/uncertain observations. Reasoning and delayed retention remain unverified.\nNext: explain why each operation preserves equality, then revisit on a fresh task at a learner-chosen delay.`);
    return { correct, attempts: count };
  } finally { reader?.close(); store.close(); }
}
