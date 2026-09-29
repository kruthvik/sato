---
name: fast-learn
description: "Rapid conceptual learning of a topic, with or without a specific deliverable. Use for an evening overview, a new subject, or near-term practical understanding."
---

# Fast Learn (Evening Overview)

Fast-learn is an **evening overview**: bounded scope, functional understanding, provisional coverage. The learner wants to understand a topic tonight without being forced into an artificial exam deadline or deliverable.

## Workflow

1. **Session Scope**: Call `configure_learning_session` with `mode: "fast-learn"`, `deliverable: "general"`, and a negotiated time budget. Define the bounded slice and state what is outside scope.
2. **Technique Loop**: Cycle through predict → explain → retrieve → discriminate → apply.
   - For open-ended reasoning, use `ask_for_explanation` to test causal models and boundary conditions.
3. **Feynman Inversion**: Conduct a teach-back inversion (mandatory once per sprint) where the learner teaches the core causal concept to a beginner.
   - Launch the student persona: `subagent({ agent: "student", task: "..." })`.
   - Maintain conversational context across turns using `action: "resume"` to continue the teach-back dialogue with the learner.
   - If factual verification or domain accuracy checks are needed during the sprint, call `subagent({ agent: "researcher", task: "..." })` to verify facts in the background.
4. **Artifacts & Synthesis**:
   - Save summary notes and remaining conceptual gaps under `content/topics/<topic>.md`.
   - Label same-session success *provisional*; durable retention requires delayed evidence.
