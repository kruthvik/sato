# Sato

Personal learning engine built on bun and pi's native terminal. It adapts instruction to the learner's goal, actual task evidence, prior help and uncertainty. uses extensive learning research from Feynman with citations in ./outputs.

## Notes and Request For Feedback

The backend and agent-cycle was personally designed, although I used an AI to improve the prompt I had built to create the core interface. The software choices were largely a result of my trail-and-error with a previous iteration of this project. A significant portion was AI-generated, and despite the fact that I was able to vet some of it, there may still be core issues due to the nature of AI-written code. If you look through the `/outputs` and `/docs` folder you should see a significant portion of the prompting and planning, although my original diagrams and whatnot aren't currently there.

What I primary vetted was the CLI, how it connects to pi-agent and ignores the global instance, and the `core` folder. I had to go through multiple revisions and prompts to fix personal issues I had with the agent loop structure.

The primary feedback that I would appreciate is feedback related to the core learning functionality and the agent loop. I'd love to hear from users who have more experience in learning research than me, who can possibly shine light on how this current approach falls short and if it currently has too much all at once. I also want to know more about the general agent loop. I added MCQ, open-ended questions, Feynman inversion, and active recall, as well as native learning-research techniques. All of these techniques were personally found to work, but I understand that they may not work for everyone. Thus, I would appreciate if users could write complaints they have with the current agent setup and how the `brain.md` file is processed.

Those who want to contribute to this project are encouraged in doing so, and can contact me through my github profile. 

## Start

Tested on Windows with **Bun 1.4.2** and **Pi 1.0.0**. Doesn't alter the global pi instance and stores information about the custom injection in a .lock file.

```sh
bun install --frozen-lockfile
bun run dev init
bun run dev
```

Inside the native Pi terminal:

```text
/login                     Authenticate your chosen provider
/model                     Select a model
/learn linear equations    Start learning toward independent use
/exam defend my argument   Rehearse an upcoming performance
/status                    Read dated evidence, uncertainty and due reviews
/stop                      Cancel and save a checkpoint
/quit                      Exit
```

Live tutoring requires a pi-compatible provider. after intake consent, conversation, relevant learning records, up to 6,000 characters of `brain.md`, and selected source excerpts may go to that provider. Educational records and originals stay local. Pi install telemetry defaults to disabled in sato settings; native pi catalog/version/package checks can still contact Pi services. explicit telemetry settings/environment flags retain pi behavior.

For a working lesson without credentials or model requests:

```sh
bun run dev demo
bun run dev demo --answers 5,7,9
```

The offline math demo teaches an example, delivers fresh tasks, offers hints and stop, scores numeric answers and reports a checkpoint. Its temporary records are separate from personal history.  `bun link` optionally exposes `learn` during development; this repository is not a published install command.

## Records and personalization

`SATO_HOME` overrides `~/.learn`:

```text
brain.md                    Learner preferences and constraints
agent/                      Isolated Pi auth/settings/resources/packages
sessions/                   Pi transcripts
pi-runtime/                 Optional checked Pi installs and active selection
data/learning.sqlite        Educational revisions, events and call logs
data/blobs/                 Untouched source originals
tutor.lock                  One active terminal tutor per home
```

Sato does not copy normal Pi credentials or discover invocation `.pi` resources/context. Pi's terminal keybindings, diagnostics and theme helpers also use Sato's agent directory, even if `PI_CODING_AGENT_DIR` points to a global instance. Ambient `~/.agents/skills` are excluded unless explicitly opted into through Sato settings. The model starts with four educational tools plus tools from reviewed installed extensions; Pi's built-in coding tools stay off. User-installed Pi extensions have OS privileges; isolation is not a sandbox.

Pi chooses small instructional moves from scoped evidence: explain unfamiliar work, repair an observed gap, seek independent work after help, fade redundant guidance and sample a useful different form. Planning is delegated at intake and for consequential replanning, not after every answer. The child uses the selected Pi model/auth runtime, one request (up to 4,096 output tokens), a 60-second cancellation deadline, and only explicitly supplied bounded facts. It has no tools, user extensions or ambient context. Plans use the existing goal/component/outline ledger; no parallel tutor or new database is introduced. The host formats facts and validates records without generating educational judgments. Seven profiles cover math, writing, science, humanities, languages, computing and practical/creative work. Curated fixtures are teaching examples, not calibrated assessments. Text cannot verify pronunciation, physical performance or laboratory execution.

No global mastery score, learning-style label or fitted forgetting curve is presented as measured knowledge. Reviews require a learner-consent response and date; no unattended reminder/model loop runs.

## Sources and practice

```sh
learn source add "C:/path/course-notes.md"
learn source list
learn source preview SOURCE_ID
learn source accept SOURCE_ID
```

In the tutor, `/source attach SOURCE_ID` selects an accepted source for the goal and requests permission to send excerpts to the provider. Other source commands also work in-session. Supported files are UTF-8 `.txt`, `.md`, `.csv`, `.tsv` and `.json`, up to 10 MB. Import preserves originals, creates stable line spans, and exposes `needs_review`. Acceptance confirms extraction, not factual truth. Retrieval is lexical search over quoted, untrusted data. Unknown source rights mean local/private processing; an export does not authorize public redistribution.

Task definitions pin exact components, family, rubric, sources, aids and conditions. Numeric/exact scoring is deterministic; open responses receive Pi rubric proposals with quoted evidence and uncertainty. Generated tasks are candidates. A bounded independent calculator can verify fresh linear equations automatically. Other generated content requires review:

```text
/approve TASK_REVISION_ID           Inspect prompt, criteria and any key
/approve TASK_REVISION_ID confirm   Approve the reviewed task
```

Viewing a key marks that item as supported evidence. The tutor cannot certify its own review, retrieve protected keys or author a protected outcome bank. Fixtures are practice, not a disjoint transfer test.

`learn source remove ID` blocks future use while retaining the original and historical provenance. It is **not a privacy purge** and does not erase transcripts, historical responses or backups.

## Maintenance

```sh
learn install npm:@scope/package@1.0.0 --trust
learn install "C:/my-extensions/helper.ts" --trust
learn list
learn remove npm:@scope/package
learn extensions
learn extensions disable "C:/my-extensions/helper.ts"
learn extensions enable "C:/my-extensions/helper.ts" --trust
learn config
learn update                  # Update Pi in Sato only
learn update --extensions --trust
learn doctor
learn status                  # --json gives a detailed context packet
learn brain show
learn brain edit              # EDITOR executable; Notepad by default on Windows
learn export private-records.json
learn backup learning-backup.json
learn plugin list
learn plugin add npm:@scope/package@1.0.0 --trust
learn plugin remove npm:@scope/package@1.0.0
learn plugin update --trust
learn pi info
learn pi update             # Update Sato's Pi, not global Pi
learn pi rollback           # Previous checked isolated installation
learn pi reset              # Return to bundled dependency, retaining installs
learn resource list
learn resource disable extensions "C:/path/extension.ts"
learn resource enable extensions "C:/path/extension.ts" --trust
learn theme list
learn theme set dark
```


Pi packages retain native npm/git/local sources, manifests and resource filters. Versioned npm packages stay pinned; use an unversioned source for tracking updates, or add the new version explicitly. Package removal uses native Pi semantics: managed package files are removed; local source files are retained. Individual extensions, skills, prompts and themes can be added, removed from configuration, enabled or disabled. `/settings` and `/reload` remain native Pi controls. See [Pi customization and updates](docs/PI.md) for examples and safety boundaries.

`learn pi update [latest|1.x.y]` installs a separate SDK, checks actual offline tutor startup, then atomically selects it for subsequent launches. Failed checks leave the previous selection active. Auth, learning records and installed customization packages are not overwritten. Unsupported major releases require an adapter update; updating global Pi has no effect on Sato. Development dependency updates can also use `bun update @earendil-works/pi-coding-agent`, followed by the checks below.

Files are created without overwriting existing outputs. Backups include a WAL-consistent database snapshot, verified originals and `brain.md`; they exclude credentials and Pi transcripts. Restore requires a **fresh** home:

```powershell
$env:SATO_HOME = 'C:/path/restored-sato'
learn restore learning-backup.json
```

Restore checks hashes, schema version, tables and SQLite integrity before publishing the database. Backups are unencrypted; restore is limited to 200 MB. If a crash leaves `tutor.lock` or `pi-runtime/update.lock`, inspect the recorded PID and verify it has exited before removing that exact file. `doctor` reports the actual Pi version and checks resource errors, database/foreign keys, original hashes and auth-file presence without printing secrets. Missing configured packages may be installed by Pi's resource loader; `doctor` is not a strictly network-free check. Auth-file presence does not prove provider access.

## Verify

```sh
bun run typecheck
bun run lint
bun test
bun run smoke
```
## Future

This is actually a redesign of a personal system I had used. This is basically a trail run of the core features, and once I aggregate enough feedback, I will implement an accelerated learning option as well as a drill based on a studying method I came across where people only use past exams and questions instead of learning from scratch. These will likely be in the form of /drill and /accelerate.

Beyond that, I also intend to add further integrations. Excalidraw, for one, could greatly benefit the current system. An activity studio would also be nice in which AIs could design custom interfaces using markdown, or at a more grand scale, possibly delegate tasks and what needs to be done to a subagent that builds it using bun or something similar. This would carry a lot of overhead and compute, so optimizing this before fully capitalizing off of it as a feature is vital. 

I would love to hear any other possible features that people would like.
