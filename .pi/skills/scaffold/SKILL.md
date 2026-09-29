---
name: scaffold
description: "Adaptive example-fading for complex skills. Selects worked example, completion, or independent performance from prior knowledge and task complexity, then fades or restores support using observed evidence."
---

# Adaptive Scaffolding

Use this skill when the unified [teach](../teach/SKILL.md) skill calls for scaffolding on a complex multi-step procedure. The core progression is always:

```
worked example → completion → independent
       ↑              ↓            │
       └──── restore only needed support ────┘
```

## MANDATORY TOOL INVOCATION POLICY

Execute tools via actual tool calls. DO NOT simulate tool interactions in markdown.

| Level | You MUST call: | NEVER do this: |
|---|---|---|
| Query readiness | `mastery({ topic, skill, mode })` | Never guess readiness |
| Completion step | `quiz({ question, correctAnswer, explanation })` | Never write plain text quizzes |
| Independent evaluation | `record_learning_evidence(...)` | Never omit evidence recording |
| Procedural drill | `start_practice_pacer(...)` | Never omit micro-rest |

## Select the starting level

Use `mastery({ topic, skill, mode })` plus the task's element interactivity:

| Evidence state | Default support |
|---|---|
| **Cold start** (`diagnose_cold_start` returned `coldStart: true`) | Level 1 unconditionally for ALL nodes in the first cluster |
| New skill or model score below 0.50 | Level 1 — worked example |
| Partial schema, score 0.50–0.79 | Level 2 — completion problem |
| Established schema, score ≥ 0.80 | Level 3 — independent problem |

Observable performance overrides numeric defaults. Also keep the reason for support explicit: weak memory, incomplete conceptual model, poor discrimination, missing prerequisite, or execution error require different interventions.

## Level 1 — Worked example

For novices or high-interactivity tasks. State the problem, segment the solution into labeled subgoals, explain why each operation follows. Ask the learner to explain one decisive step or predict the next. Advance when the learner can identify subgoals and complete a near-transfer step without a material hint.

## Level 2 — Completion problem

Provide setup and routine steps, remove the conceptually decisive portion. Ask the learner to produce the crucial step without options, explain why it applies and why a neighboring method does not. Give immediate mechanism-specific feedback. Retry with changed surface context.

## Level 3 — Independent performance

Present the target-like task without solution steps or method labels. Change surface details so the learner must select the schema. Require method selection, complete execution, explanation of conditions, and a check or counterexample. Call `record_learning_evidence` with rubric-derived score and actual hint count.

If the learner fails: classify the error → restore only the support addressing that error → escalate feedback minimally (location → hint → principle → partial → full solution) → use a new problem after an intervening step.

## Transition rules

- Fade one support dimension at a time: method label, subgoal list, partial steps, cue, feedback timing.
- Vary examples enough to reveal invariant structure. Compare two positive cases with different surfaces, a near-miss alternative, and a novel transfer case.
- Interleave only after the learner has a rudimentary schema for each included type.
- Do not call a skill mastered from same-session success. Durable mastery requires delayed retrieval.

## Content and Obsidian

Store worked examples, completion sheets, and practice sets under `content/` and link from `content/sessions/`. Use KaTeX ($...$, $$...$$) for equations. Place provisionally-gapped concepts in escrow for delayed verification.
