# Sato — Pi configuration

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

This project builds on the learning approach described in [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU), with attribution in [`../NOTICE.md`](../NOTICE.md).

Sato adapts this learning system into a complete local workspace. It keeps the learning policy in a small core and adds focused Pi skills, extensions, and agent definitions around it.

Just ask a question or describe what you want to learn. A focused question gets a direct answer; a sustained goal starts a structured session with practice and honest evidence checks. `brain.md` is read at startup, and relevant Obsidian notes stay behind the scenes. `/mode` shows a short current-goal summary; `/new-session` clears this chat's plan. The deeper tools below are available when the learning task calls for them, not a checklist the learner must operate.

## What's in it

- `skills/teach/` — deep learning and delayed-mastery flow
- `skills/fast-learn/` — time-boxed conceptual understanding, including open-ended evening explorations with no exam
- `skills/cram/` — the same active conceptual loop, weighted toward an imminent performance target
- `skills/project/` — learner-owned artifact milestones, explanation, critique, and delayed recreation
- `skills/scaffold/` — adaptive worked-example → completion → independent practice
- `skills/activity-studio/` — Learning Activity Spec language for on-demand browser exercises, simulations, and custom assessment forms
- `skills/visualize/` — adds a correct, minimal diagram to a lesson when an idea is clearer as a picture
- `extensions/ask-user-question.ts.disabled` — bundled fallback; keep disabled when another installed extension provides `ask_user_question`
- `extensions/quiz.ts` — graded questions with instant feedback (✓/✗, correct answer, explanation)
- `extensions/learning-session.ts` — chat-scoped mode, target, time budget, and phase tracker; new chats start fresh and resumed chats restore their own plan
- `extensions/vault-garage.ts` — internal Obsidian context capture for connected session handoffs, source-grounded summaries, observed explanation outcomes, and candidate outliers under `_learning/garage/`; its YouTube tool reads public captions directly in bounded parts with Bun, without downloading video
- `extensions/activity-studio.ts` — validates, serves, grades, and records custom web activities generated from the LAS language
- `extensions/learning-runtime-check.ts` — warns when the isolated profile is missing subagents, learner questions, or researcher web tools; exposes `/learning-doctor`
- `extensions/bkt-engine.ts` — multidimensional evidence engine, gap escrow, error diagnosis, scope-aware readiness reporting (including untested graph skills), and deadline-aware cram control
- `extensions/dag-manager.ts` — typed domain graph plus research-gated next-action selection and decision telemetry
- `extensions/fsrs-scheduler.ts` — long-term review plus optional same-day acute checkpoints
- `core/action-selector.ts` — target-time, rate-of-gain policy with prerequisite, spacing, misconception, deadline, and sleep gates
- `core/memory-controller.ts` — session-scoped spacing and rest state plus inter-session retrievability calculations
- `extensions/visual-tools/` — tools for visualization subagents
- `extensions/blurt.ts` — structured free-recall (blurt) cycles with timed reading, occluded generation, and discrepancy analysis
- `extensions/wakeful-rest.ts` — post-encoding consolidation timer that blocks new content during quiet rest
- `extensions/micro-rest.ts` — practice/rest interval pacer for micro-offline consolidation during skill building
- `extensions/loci-builder.ts` — Method of Loci (Memory Palace) construction, deposition, retrieval walks, and Major System encoding
- `extensions/web-memorize.ts` — local browser web app for active recall flashcards, live FSRS spaced syncing, and Bönstrup 10-second micro-rest intervals (`open_memorize_web`, `/memorize`, `/flashcards`)
- `agents/` — researcher, student, note, card, grading, and verified-visual subagents
- `content/` — canonical Obsidian tree for every learner-visible generated note, activity companion, visual, and export
- `_learning/` — operational learner state and telemetry; never the sole copy of generated course material

For a quick video explanation, use `/video <YouTube link> [optional focus]` or ask in plain language. The tutor reads available captions, leads with a short gist and useful timestamps, and connects the ideas to your current goal when relevant. Obsidian notes stay internal.

## Install

Keep the **whole Sato workspace** together: `.pi/` contains the learning configuration, while `scripts/`, `package.json`, `content/` and `_learning/` are workspace-relative. Copying only `.pi/` will not reproduce this installation. From the workspace root run `bun install`, then `bun run setup`, then `learn.cmd` (or `learn.ps1`). See the root [`README.md`](../README.md) for requirements and first-run instructions.

## Requirements

- [pi](https://github.com/earendil-works/pi) and [Bun](https://bun.sh/) on PATH; Node/npm is used for the documented checks.
- `learn.cmd` provisions `pi-subagents`, `@juicesharp/rpiv-ask-user-question`, and `pi-web-search-and-fetch` inside its isolated Pi profile. These provide the student/researcher children, learner-response UI, and web tools used by background research agents.

## Profile isolation

Start with `learn.cmd` or `learn.ps1`, not bare global `pi`. The launcher sets `PI_CODING_AGENT_DIR` to **`<workspace>/.learn-runtime/`**; project extensions, skills, generated material, isolated provider packages, settings and credentials all stay inside this directory tree. Pi and Bun executables must still be installed on PATH; packages are provisioned into the local profile on first launch. No global Pi settings, credentials, skills, or extensions are imported. Authenticate in the local profile on first use. Keep `.learn-runtime/` private and out of version control; `learn.ps1 /doctor` checks the workspace and the effective profile.

The launcher hides raw `bash` and `powershell` tools. The workspace guard also limits Pi's built-in file tools to the learning workspace and protects engine files. These are application-level controls; Pi extensions execute with the Windows account's permissions, so they do not provide a hard operating-system sandbox. Activity Studio accepts declarative items and does not execute generated scripts or ship a hardcoded external graphing key. Noncanonical symbolic answers, speaking and sheets are pending tutor review rather than auto-scored wrong or credited. Its simulation mode is a self-honored test, not a tamper-proof proctor; `simulate_assessment` records conditions but does not enforce them. The modes share one contract: map scope, explain and demonstrate, elicit production, repair errors, assess every mapped skill, and disclose untested gaps. Readiness remains provisional until delayed independent and, when relevant, external performance supports a stronger claim.

## Notes

If a required subagent fails, the teaching skills report the failure and run the same bounded explanation check directly; they do not silently skip it. Use `/subagents-doctor` to inspect the provider.

The model thresholds route practice; they are not literal probabilities or grade predictions. See [`RESEARCH.md`](RESEARCH.md) for the evidence base, limitations, and implementation decisions.
