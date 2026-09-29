# Provenance

This document records where each part of this project came from, so the licensing
position is auditable. It was produced by diffing this workspace against the
upstream commit `7cfd894` of <https://github.com/amosblomqvist/learn>.

## Summary

| Category | Files | Approx. bytes | Copyright position |
| --- | --- | --- | --- |
| New — not present upstream | 51 | 639,353 (65.4% of `.pi`) | Original to this project |
| Inherited — present upstream and modified here | 16 | — | Derivative; upstream author's original expression remains |
| Inherited — byte-identical to upstream | 1 | — | Upstream author's work, unmodified |
| Inherited — deleted here | 2 | — | Removed |

Everything outside `.pi/` — `scripts/`, `package.json`, `learn.cmd`, `learn.ps1`,
`content/`, `_learning/`, `research/`, `brain.md`, and `organization.md` — is
original to this project and does not appear upstream.

## New — original to this project (51 files)

These do not exist in the upstream repository, so there is no upstream expression
in them to license.

**Core engine** — `core/`
`action-selector.ts`, `action-taxonomy.ts`, `brain.ts`, `domain-graph.ts`,
`fsrs.ts`, `integrations.ts`, `learning-events.ts`, `memory-controller.ts`,
`packages.ts`, `policy.ts`, `policy-evaluator.ts`, `teaching-context.ts`,
`themes.ts`, `vault-garage.ts`, `youtube-transcript.ts`

**Extensions** — `extensions/`
`activity-studio.ts`, `ask-user-question.ts.disabled`, `bkt-engine.ts`,
`blurt.ts`, `dag-manager.ts`, `document-viewer.ts`, `explain.ts`,
`fsrs-scheduler.ts`, `learning-runtime-check.ts`, `learning-session.ts`,
`loci-builder.ts`, `markdown-to-pdf.ts`, `micro-rest.ts`, `session-init.ts`,
`theme-manager.ts`, `vault-garage.ts`, `wakeful-rest.ts`, `web-memorize.ts`,
`workspace-guard.ts`

**Skills** — `skills/`
`activity-studio/` (SKILL.md, assets/activity-runner.html,
references/activity-spec.md), `cram/`, `exam-drill/`, `fast-learn/`, `project/`,
`scaffold/`

**Agents, config, themes, docs**
`agents/anki-maker.md`, `agents/frq-grader.md`, `agents/note-maker.md`,
`agents/student.md`, `config/learning-policy.json`, `themes/editorial.json`,
`themes/midnight.json`, `themes/nord.json`, `RESEARCH.md`

## Inherited and modified here (16 files)

These began as Amos Blomqvist's files and were edited. The edits add to and
change his original expression, so they remain derivative works.

`.gitignore`, `README.md`, `assets/thumbnail.png`,
`agents/mermaid-maker.md`, `agents/researcher.md`, `agents/svg-maker.md`,
`extensions/quiz.ts`, `extensions/visual-tools/index.ts`,
`extensions/visual-tools/package-lock.json`, `extensions/visual-tools/package.json`,
`extensions/visual-tools/tools/_common.ts`,
`extensions/visual-tools/tools/mermaid_tools.ts`,
`extensions/visual-tools/tools/svg_tools.ts`,
`skills/teach/SKILL.md`, `skills/visualize/SKILL.md`

## Inherited and unmodified (1 file) — upstream author's work

`extensions/visual-tools/.gitignore` (byte-identical to upstream)

## Deleted here (2 files)

`extensions/ask-user-question.ts`, `extensions/md-log.ts`

## Permission note

Several original files interoperate with the inherited ones — the teaching skills
reference the upstream `teach` skill, and the extension runtime loads the upstream
agent definitions. The upstream author has given permission to publish this
derivative project. See [`NOTICE.md`](NOTICE.md) for the permission and licensing
context; this provenance inventory does not grant additional reuse rights.
