---
tags: [learning/content-index]
---

# Learning content

This is the canonical file store for material the learner may receive through chat, the browser activity, or an export. Obsidian indexes the workspace for the tutor; learners do not need to open or manage the vault.

- `sessions/` — automatic conversation logs, fast-learn handoffs, and cram sheets
- `topics/` — evergreen concept notes that integrate foundations, examples, misconceptions, and retrieval prompts
- `activities/` — readable exports of generated browser activities
- `exports/` — Anki TSV files and other portable learner-facing exports

Operational state and telemetry remain in `_learning/`. Source documents supplied by the learner remain in `sources/`. AI-generated course material must not use either location as its only copy.

The tutor's private context garage is `_learning/garage/`. It holds compact session handoffs, source summaries with provenance, teaching-approach observations, and candidate performance outliers. Those notes help the tutor plan and explain; they are not learner-facing deliverables or substitutes for recorded assessment evidence.

## Persistence rule

If generated material is shown to the learner or exported for later study, save a Markdown or export-source copy under `content/` in the same turn. Prefer updating an existing topic note over creating duplicates. Use Obsidian links between session notes, topic notes, activity exports, and relevant source files whenever the relationship will help later retrieval.
