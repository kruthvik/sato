import type { Assessment, Assistance, Attempt, LearningEvent, TaskDefinition, TaskInstance } from "../../core/src/contracts.ts";
import type { LearningStore } from "./store.ts";

export interface Observation {
  assessment_event_id: string; attempt_id: string; component_revision_id: string; outcome: Assessment["outcome"];
  observed_at: string; eligibility: "independent" | "supported" | "uncertain"; assistance_event_ids: string[];
  task_family_revision_id: string; purpose: TaskInstance["purpose"]; allowed_aids: string[];
  delay_days: number | null; changes: string[]; uncertainty: string;
}
export interface ComponentView {
  component_revision_id: string; observations: Observation[];
  independent: Observation[]; supported: Observation[]; retained: Observation[]; applied: Observation[];
  current_claim: "unverified"; through_seq: number; as_of_time: string; projector_version: "1";
}

/** Facts only: this reducer never calls a model, scores prose, or reads the current clock. */
export function projectComponents(store: LearningStore, throughSeq: number, asOfTime: string): ComponentView[] {
  const cutoff = Date.parse(asOfTime);
  const events = store.events(throughSeq).filter(e => e.branch === "real" && Date.parse(e.occurred_at) <= cutoff);
  const views = new Map<string, ComponentView>();
  for (const component of store.revisions("component", throughSeq)) views.set(component.revision_id, { component_revision_id: component.revision_id, observations: [], independent: [], supported: [], retained: [], applied: [], current_claim: "unverified", through_seq: throughSeq, as_of_time: asOfTime, projector_version: "1" });
  const attempts = new Map(events.filter(e => e.kind === "attempt_submitted").map(e => [e.payload.attempt_id as string, e as unknown as LearningEvent<Attempt>]));
  const corrected = new Set(events.filter(e => e.kind === "assessment").map(e => e.payload.correction_of_event_id).filter(Boolean));
  for (const event of events) {
    if (event.kind !== "assessment" || corrected.has(event.event_id)) continue;
    const assessment = event.payload as unknown as Assessment;
    // Meaningful steps stay in the ledger; dependent steps are not independent repetitions.
    if (assessment.step_attempt_id) continue;
    const attempt = attempts.get(assessment.attempt_id);
    if (!attempt) continue;
    const instance = store.revision<TaskInstance>(attempt.payload.instance_revision_id).body;
    const task = store.revision<TaskDefinition>(instance.definition_revision_id).body;
    const response = events.find(e => e.event_id === attempt.payload.response_event_id);
    if (!response) continue;
    const submittedAt = response.occurred_at;
    for (const component of task.component_revision_ids) {
      const view = views.get(component);
      if (!view) continue;
      const assistance = events.filter(e => {
        if (e.kind !== "assistance" || e.occurred_at > response.occurred_at || (e.occurred_at === response.occurred_at && e.seq >= response.seq)) return false;
        const a = e.payload as unknown as Assistance;
        return a.instance_revision_id === attempt.payload.instance_revision_id && (a.component_revision_ids.length === 0 || a.component_revision_ids.includes(component)) && ["exposed", "possibly_exposed"].includes(a.stage) && a.answer_bearing;
      });
      const undeclaredAids = attempt.payload.declared_aids.filter(a => !task.allowed_aids.includes(a));
      const reviewedKey = events.some(e => e.seq < response.seq && e.kind === "decision" && e.payload.action === "task_solution_reviewed" && e.payload.task_entity_id === store.revision(instance.definition_revision_id).entity_id);
      const eligibility = assistance.some(e => e.payload.stage === "possibly_exposed") || undeclaredAids.length > 0 ? "uncertain" : assistance.length > 0 || reviewedKey ? "supported" : "independent";
      const priorExposures = events.filter(e => {
        if (e.seq >= response.seq || e.occurred_at > submittedAt) return false;
        if (e.kind === "assistance") return (e.payload.component_revision_ids as string[]).includes(component) && ["exposed", "possibly_exposed"].includes(e.payload.stage as string);
        if (e.kind !== "attempt_submitted" || e.payload.attempt_id === assessment.attempt_id) return false;
        const prior = store.revision<TaskInstance>(e.payload.instance_revision_id as string).body;
        return store.revision<TaskDefinition>(prior.definition_revision_id).body.component_revision_ids.includes(component);
      });
      const latestExposure = priorExposures.map(e => e.occurred_at).sort().at(-1);
      const delay = latestExposure ? Math.max(0, (Date.parse(submittedAt) - Date.parse(latestExposure)) / 86400000) : null;
      const observation: Observation = { assessment_event_id: event.event_id, attempt_id: assessment.attempt_id, component_revision_id: component, outcome: assessment.outcome, observed_at: submittedAt, eligibility, assistance_event_ids: assistance.map(e => e.event_id), task_family_revision_id: task.family_revision_id, purpose: instance.purpose, allowed_aids: task.allowed_aids, delay_days: delay, changes: task.changes, uncertainty: assessment.uncertainty };
      view.observations.push(observation);
      if (eligibility === "independent") view.independent.push(observation); else view.supported.push(observation);
      if (eligibility === "independent" && assessment.outcome === "success" && instance.purpose === "retention" && delay !== null && delay > 0) view.retained.push(observation);
      if (eligibility === "independent" && assessment.outcome === "success" && instance.purpose === "application" && task.changes.length > 0) view.applied.push(observation);
    }
  }
  return [...views.values()];
}
