---
name: activity-studio
description: "Create a purposeful multi-item local browser learning activity: mixed short answer, discrimination, math, cloze, matching, ordering, speaking practice, sheet or reflection. Use when one quiz question is insufficient; avoid rote flashcard review."
---

# Activity Studio

Read [the LAS reference](references/activity-spec.md) before authoring. The core activity is local and self-contained: no generated JavaScript, arbitrary HTML, CDN or hardcoded external API. Supported item types are `content`, `choice`, `multi-select`, `text`, `numeric`, `expression`, `integral`, `cloze`, `match`, `order`, `reflection`, `speaking`, `sheet`, and `accounting-sheet`. Speaking and sheets are captured for tutor review; they are not automatically verified. Algebraically equivalent expressions and antiderivatives outside accepted strings also need review. For a graph, code execution or simulation use a separate explicitly authorized tool—not an executable LAS payload.

## Learning contract

1. Choose a bounded observable objective and the mapped skills to test. A rich activity is appropriate when format or variation adds value; use `quiz` or `ask_for_explanation` for a single probe. A typical set is 4–12 items, but the evidence requirements apply **per assessable skill**, not per arbitrary item count. Do not hide untested mapped skills in a high overall score.
2. Use `content` blocks to establish context, **not** to disclose the answer. Prefer short-answer production, explanation and changed-case application. `choice`/`multi-select` default to recognition even in `simulation`; set `taskType: "discrimination"` only for a genuine nearest-trap contrast. Never relabel selection as transfer. `reflection` is ungraded: inspect and evaluate it separately via `record_learning_evidence` after submission. Automated short-text matching is for concise answers, not causal prose.
3. Keep private keys only in `answer`, `answers`, `acceptedAnswers`, `blanks`, `pairs` or `steps`, never in learner-visible `prompt`, `instructions`, `content` or an export. For math include common exact notations and treat unfamiliar symbolic answers as pending review. The browser is **not a secure proctor**: it can present a self-honored aid-matched simulation, but source inspection and external materials cannot be prevented.
4. Call `open_learning_activity({ activity })`, then after submission `get_activity_results({ activityId })`. The server-verified result overrides local estimates. Identify misses and pending responses. For misses call `diagnose_error`, teach a contrast/worked repair, and later test an independent changed case. For pending explanations or symbolic work evaluate the raw response yourself and record evidence with actual assistance and novelty. Never infer durable mastery from a browser pass.
5. Close with `mastery_report({ topic, mode })` and disclose mapped, untested, pending and unresolved skills. Use `schedule_review` for delayed verification. The learner generates an attempt before feedback: **commit → retrieve/generate → feedback → contrast → changed case → later reassessment**. Feedback appears only after submission; do not reveal keys in chat.

Appearance: the default `study` preset shares dark monochrome tokens with the memorizer and settings. `editorial`, `technical`, or `midnight` are deliberate variations, not separate products. Choose `split` only when passages and questions benefit from side-by-side layout; preserve accessible contrast, labels and mobile width.
