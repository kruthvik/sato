---
tags: [learning/guide]
cssclasses: [dashboard]
---

# Ultimate Learning Engine

Obsidian is the tutor's internal index and context garage. The learner works in chat, browser activities, and exported material; no vault navigation is required.

This vault is organized around one repeatable loop:

```text
Target → diagnose → model → generate → retrieve → correct → compare → vary → transfer → space → reassess
```

The system chooses a different time/depth tradeoff without changing that core loop.

## Choose one mode

| Command | Best for | Readiness standard |
|---|---|---|
| `/teach` | Deep understanding and long-term transfer | Independent performance plus delayed retrieval |
| `/fast-learn` | Understanding a topic well enough to use in 15–90 minutes | Closed-source explanation plus one target-like application |
| `/cram` | An imminent test, essay, presentation, or major assignment | Point-weighted coverage plus a format-matched simulation |

Use fast-learn when unfamiliar material needs to become usable. Use cram when the graded target is known and the main problem is prioritizing and producing under a deadline.

The command `/mode` shows the active mode, current phase, and next priority.

## What the engine tracks

- `_learning/current-session.json` — a dashboard mirror of the latest active mode, observable objective, deliverable, time boxes, and phase progress. Every learning-skill invocation starts a fresh plan. Authoritative state remains scoped to its Pi chat, so continuing a plan requires reopening that chat with Pi's native `/resume` rather than invoking the skill again.
- `_learning/activities/` — generated Learning Activity Specs, browser pages, and timestamped result evidence from Activity Studio.
- `_learning/graphs/` — dependency maps. Cram graphs can also store Tier 1/2/3 priority and assessment weight.
- `_learning/mastery/` — evidence history and a BKT-style model score for each skill.
- `_learning/reviews/` — spaced-review cards and same-day checkpoints.
- `content/sessions/` — learner-facing handoffs and cram sheets when generated.
- `content/topics/` — evergreen concept notes with contrasts, transfer cases, and retrieval prompts.
- `content/activities/` — readable companions and submitted feedback for generated browser activities.
- `content/assets/` — verified diagrams and other generated learner-visible media.
- `content/exports/` — Anki TSV and other portable exports.
- `_learning/` — operational graphs, learner-model state, scheduling data, activity runtime files, and telemetry; never the only copy of learner-visible generated material.
- `_learning/garage/` — private, connected Obsidian notes for session plans, source-grounded summaries, teaching approaches, and candidate outliers.

## Internal context garage

`configure_learning_session` creates a compact session note and retrieves relevant garage context automatically. `unlock_next` also returns relevant context for explanation design while its action selection continues to use observed performance and the existing gates. `brain.md` supplies learner-authored preferences; a useful or ineffective explanation can be recorded with `record_teaching_approach` after observing the response.

For YouTube, call `read_youtube_transcript` with a public video URL. It reads caption text directly through Bun, in bounded timestamped parts; read every part before calling the result a full-video summary. Then use `capture_learning_source` to save a concise synthesis and a short evidence excerpt. A link with no accessible captions supports only a metadata note. The capture tool also handles inspected webpages, documents, books, and other sources. Notes link to recent session notes and existing topic notes; additional existing paths can be connected explicitly. `get_learning_context` retrieves the topic's recent notes. No video download, API key, or added package is required. Caption access can change when YouTube changes its player endpoint; `npm run test:youtube:live` checks a public captioned video.

`analyze_learning_outliers` compares each unaided, non-repeated attempt with three earlier attempts for the same skill, task type, and representation. It records candidate shifts with event IDs and makes no causal or mastery claim. Investigate difficulty and conditions before changing instruction. Garage notes never override safety rules, assessment integrity, or the learner model.

## How evidence works

The model distinguishes evidence format:

1. recognition;
2. cued recall;
3. free recall;
4. self-explanation;
5. application or format-matched performance.

Interpret that evidence across separate learner dimensions: memory accessibility, structural understanding, discrimination, confidence calibration, and transfer. A learner can be strong on one and weak on another; do not collapse the intervention decision into one percentage.

A multiple-choice answer is useful diagnostic evidence, but it is not treated like solving a new problem or writing an argument unaided. Diagnostic pretests are also separated from post-instruction assessment.

Mode gates are routing rules:

- cram readiness: model score ≥ 0.70 plus successful target-like performance;
- fast-learn readiness: model score ≥ 0.80 plus explanation/application;
- teach mastery candidate: model score ≥ 0.95 plus independent performance and confidence calibration.

These scores are not literal probabilities, grade predictions, or durable-mastery guarantees. Later retrieval is the durability check.

## During a learning session

### 1. Configure

State the topic, observable goal, required output, focused time available, deadline, and source/rubric location. The agent builds one small timed plan.

### 2. Diagnose

Attempt representative questions before studying. A short diagnostic finds known foundations, missing dependencies, misconceptions, and high-value gaps.

### 3. Map

The agent creates the shortest sound dependency graph. In cram mode, low-yield material is explicitly discarded instead of silently consuming time.

### 4. Learn actively

- New complex procedure: worked example → completion problem → independent problem.
- Dense facts or sequence: read → close source → recite → compare → retry.
- Conceptual network: closed-source blurt with relationships and conditions.
- Essay: externalized outline → uninterrupted drafting → separate structural/mechanical audit.

### 5. Verify in the real format

The last meaningful attempt resembles the actual test, essay, presentation, or task. Coaching stops during the attempt. Readiness requires production, not familiarity.

### 6. Preserve what matters

High-value gaps become small review cards. Exact duplicates are merged. Fast-learn and cram can schedule a same-day checkpoint when the learner will actually return; teach uses delayed retrieval to test durability.

## Attention and physiology

- Protect planned sleep, especially before tasks requiring sustained attention, working memory, or error detection.
- Use naps as an option when sleepiness and time justify them, not as a universal fixed-cycle rule.
- Keep phones and irrelevant notifications out of reach when they distract you.
- Avoid experimenting with unfamiliar stimulants or dosing plans. Substantial late caffeine can disrupt sleep.
- Leave transition time before the evaluation to arrive, set up, and settle. No fixed minute count works for everyone.

## Commands

- `/teach` — deep learning mode.
- `/fast-learn` — rapid usable understanding.
- `/cram` — deadline and score-focused preparation.
- `/mode` — active session and phase.
- `/mastery <topic>` — durable-threshold summary.
- `/reviews` — review queue status.
- `/warmup` — due-review status.

The implementation decisions live in [`.pi/RESEARCH.md`](../.pi/RESEARCH.md); the full synthesis is in [`research/learning.md`](../research/learning.md).
