---
name: cram
description: "Time-boxed conceptual learning and representative performance preparation for an imminent assessment, essay, presentation, or assignment. Teach like fast-learn, then prioritize the actual performance bottleneck."
---

# Cram (Deadline Preparation)

Cram adds a **performance deadline** to the learning loop. Cram changes *scope and allocation*, not the requirement to think. If there is no imminent deadline or deliverable, use fast-learn instead.

## Workflow

1. **Session Scope**: Call `configure_learning_session` with `mode: "cram"`. Explicitly record the task, rubric, deadline, allowed aids, format, and protect a mandatory sleep/performance buffer.
2. **Prioritization & Bottlenecks**:
   - Rank gaps by expected assessment yield using `cram_decision`.
   - Run active retrieval and probe causal reasoning with `ask_for_explanation`.
3. **Compressed Feynman Inversion (`student` subagent—mandatory)**:
   - Run a rapid inversion where the learner explains the highest-yield confusing concept to a beginner.
   - Invoke: `subagent({ agent: "student", task: "..." })`.
   - On follow-up questions, resume the same child subagent across turns to preserve the dialogue flow.
   - When factual or rubric verification is needed, invoke `subagent({ agent: "researcher", task: "..." })`.
4. **Assessment Simulation & Handoff**:
   - Use `simulate_assessment` for timed independent practice under exam conditions.
   - Write a compact performance handoff sheet to `content/sessions/cram-sheet-<topic>.md`.
   - Never sacrifice necessary sleep for one more low-yield drill.
