import type { PlannerDraft } from "../src/planning.ts";
export const draft: PlannerDraft = {
  goal: { subject: "computing", horizon_days: 30, target_format: "Build a small working program", criteria: ["Explain what the program does"], allowed_aids: [], constraints: [] },
  probe: "offer", summary: "Let's start with one small Python program.",
  components: [{ title: "Python variables", behavior: "Use a variable in a short program", uncertainty: "Starting ability has not been observed" }],
  outline: { next_activities: ["Explain and try one variable"], known_gaps: [], uncertain_assumptions: ["Python inferred from the learner's goal; ability is unverified"] },
};
