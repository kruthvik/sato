# Project organization

A plain-language map of this workspace. **This document does not rename files or change how the learning engine works.**

## Start here

| I want to… | Go to… |
| --- | --- |
| Describe how I like to learn | [`brain.md`](brain.md) |
| Find my lessons and notes | [`content/`](content/) |
| Find material I supplied | [`sources/`](sources/) |
| Find written reports or drafts | [`outputs/`](outputs/) |
| Start the local experience | `learn.cmd` (Windows) or `learn.ps1` (PowerShell) |

`brain.md` is read automatically when a Pi session starts. It guides explanations and pacing, but observed independent performance and assessment rules take precedence. The learner does not need to ask for it to be read.

## How the engine fits together

The learner can simply state a goal. Skills choose a teaching mode; the chat-scoped session tracks the current plan. The core selects and checks learning actions from recorded performance. One small delivery layer combines `brain.md` and relevant Obsidian garage notes to shape explanations, without changing evidence or safety decisions. `content/` holds learner-facing work; `_learning/` holds internal state and the garage. Commands such as `/mode` are optional, not a required workflow.

## Current structure

```text
brain.md          Your editable learning preferences
content/          Learner-facing sessions, topic notes, activities, exports
sources/          Material supplied for studying
outputs/          Reports and other generated work
papers/           Research papers
research/         Research working material
_learning/        Engine state, learning evidence, internal Obsidian garage (leave intact)
.pi/              Project agent configuration (leave intact)
.learn-runtime/   Local runtime (leave intact)
scripts/          Checks and supporting programs (leave intact)
```

For learner-facing material, [`content/README.md`](content/README.md) remains the canonical filing guide. New topic notes belong in `content/topics/`; session records in `content/sessions/`; activity exports in `content/activities/`; portable outputs in `content/exports/`. Do not store a learner-facing document only in `_learning/`.

## Future rename proposal — **not applied**

A more approachable vocabulary could be adopted later, but renaming live directories today would break paths in launchers, tests, skills, links, and stored data. This is a reviewable naming proposal, **not** an instruction to move anything now.

| Current name | Proposed display name | Why / caution |
| --- | --- | --- |
| `content/` | `library/` | More familiar to readers; would require updating Obsidian links, exporters, and document tools. |
| `sources/` | `my-materials/` | Distinguishes learner-supplied input from generated notes; source ingestion paths must be updated. |
| `outputs/` | `reports/` | Makes the purpose clearer, but first inventory all output types. |
| `papers/` and `research/` | `research/papers/` and `research/notes/` | Groups research together; verify references and file discovery before moving. |
| `_learning/` | Keep as-is | Machine-managed evidence is not a user-facing folder; renaming risks history and migrations. |
| `.pi/`, `.learn-runtime/`, `scripts/` | Keep as-is | Infrastructure paths are part of the working system. |
| `scratch/` | Keep as-is | Disposable workspace; changing it offers little benefit. |

### Safe migration sequence, if approved later

1. Inventory all literal paths, links, imports, scripts, runtime readers/writers, and saved state that mention a candidate directory.
2. Choose whether a friendlier *display label* alone is enough; prefer that over a physical rename.
3. If physical renames are necessary, plan compatibility aliases/migrations and a rollback for existing learner data.
4. Update one directory at a time, with tests and a real end-to-end launch and document export after each change.
5. Remove aliases only after confirming older sessions and links still resolve.

The current paths remain authoritative until a separate functional migration is explicitly requested and validated.
