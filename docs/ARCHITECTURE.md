# Sato architecture

One learner, one Bun host, one native Pi conversation and one educational SQLite database. The existing workspace packages are internal modules, not separate services.

```text
apps/cli             Launch, intake entrypoints, maintenance and plugins
packages/runtime     Paths, lifecycle, loopback service, context and backup
packages/pi          Pi SDK/native terminal, trusted extension and call hooks
packages/core        Strict contracts, subject profiles and readable status
packages/storage     Immutable SQLite ledger and temporal evidence reducer
packages/sources     Original files, text extraction, review and lexical search
packages/activities  Curated fixtures, equation verifier and offline lesson
resources            Tutoring policy and concise learning skill
```

Pi owns teaching, model calls, grading proposals and the next instructional move. Bun owns records, reference/revision checks, objective scoring and evidence eligibility. The context compiler selects bounded stored facts with explicit sequence/time inputs and reports omissions; it never calls a model or makes fresh mastery judgments.

The simplified intake and consequential outline requests delegate planning to a short-lived Pi SDK child session. The learner supplies a goal and one optional note, not a subject or curriculum. The child infers scope from supplied facts, uses the parent's selected model/auth runtime, and returns a strict proposal with at most three components and four next activities. It has no tools, user extensions, skills, ambient context, retries, compaction or cache warming. A transport-bound proxy permits one request with at most 4,096 output tokens; a 60-second deadline and Esc/stop cancellation abort the child. The parent validates and atomically commits existing Goal/Component/Plan records only if the goal is still current. Provider consent and source selection remain non-model controls. Stable replan request receipts prevent duplicate calls after successful retries. The conversational tutor retains local teaching decisions; this is not an unattended multi-agent workflow.

The native terminal uses Pi's public `createAgentSessionRuntime`, `createAgentSessionServices`, `createAgentSessionFromServices` and `InteractiveMode`. This follows main.md's SDK alternative and the repository's existing adapter. Pi native shutdown exits the process; an exit handler closes the service and releases the tutor lock. Session replacement checkpoints without closing the host.

The loader uses dedicated Sato config/auth/resource/session roots, disables ambient context discovery and filters automatic ~/.agents/skills while retaining literal opt-ins. Explicit Sato packages remain native Pi resources. Invocation cwd is preserved separately. Concrete built-in extension entries avoid importing an empty extension directory. The terminal's process-local `PI_CODING_AGENT_DIR` is bound to Sato for native keybindings, diagnostics and theme helpers. Configured npm packages are provisioned under Sato's agent directory before discovery and reload, preventing Pi's legacy global npm fallback. No global Pi auth is copied. Trusted extensions still have OS privileges.

All production runtime imports pass through `packages/pi/src/sdk.ts`. Pi 1.x is a normal runtime dependency, not a fork or copied implementation. An optional `pi-runtime/active.json` selects an independently installed SDK using its public ESM export. Updates use immutable installation directories, an exclusive maintenance lock, an actual provider-free tutor startup check and atomic selection publication. Rollback rechecks the previous SDK; reset archives the selection without deleting installs. Neither operation changes learner records or authentication. Major-version changes require an adapter review. The current process retains its SDK; new launches use the selected version.

Native Pi package/settings APIs own package installation, updates, removal and resource filters. Top-level switches configure standalone resources; package-specific switches preserve Pi's `packages[].extensions/skills/prompts/themes` format. `noTools: "builtin"` disables built-in coding tools without a hard allowlist that would prevent extension tools from being registered. Sato's four educational tools and policy remain an inline extension layered onto Pi's native conversation, resource loader and terminal.

Four tools use authenticated random-port loopback IPC: `learning_context`, `learning_define`, `learning_record` and `learning_source`. A separate launch token protects telemetry. Browser origins, unknown operations and invalid schemas are rejected. Tools cannot submit SQL or fabricate learner_response events. Actual user text, consent/source selection and human review enter through non-model controls.

The seven tables are object_revision, event, model_call_log, projection, blob_manifest, source_span and job. WAL, foreign keys, short transactions, immutable-write triggers, stable operation IDs and content hashes protect records. The job cache is reserved for future adapters; small text imports currently finish synchronously. Projection caches are disposable.

Attempts reference captured learner messages after delivery, in the same conversation. Frozen tasks pin goal, family, definition and rubric revisions. Semantic validation rejects stale parents/goals, unrevised keys, invalid scores, invented evidence quotes and mismatched corrections. Numeric/exact outcomes are computed from the frozen key; rubric judgments remain attributed Pi proposals.

Assistance distinguishes offers from possible/actual exposure and records task/attempt/step/component scope. Feedback is conservatively logged as possibly exposed support for another attempt on the same instance. Corrections append; dependent steps do not become independent repetitions. Repeated supported success never erases an independent failure.

The explicit sequence/time reducer preserves dated performance, actual delayed checks, task changes and uncertainty. It excludes hypothetical branches and never reads an ambient clock or invokes a scorer/model. Late-recorded earlier help can change current eligibility without rewriting history. An old successful answer remains an observation; current ability is unverified until tested.

Provider hooks record observed request starts, hashes and HTTP status. Unobservable stream terminal state, internal retries, compaction correlation, usage and cost remain unknown. Agent turns are not substituted for actual calls.

The bounded child separately attributes its single request's terminal message and reported usage/cost to `pi_planner_request`. Provider-internal auth/transport work remains outside hook coverage. Its transient transcript is disposed, while accepted outlines and call records remain local.

Sources are untouched content-addressed files and versioned line spans. Acceptance is explicit; unknown rights stay local/private; selected excerpts are untrusted quoted data. Removal blocks future retrieval and dependent delivery while retaining historical provenance. No source code or document instruction is executed.

Backup serializes committed WAL content, normalizes only the detached snapshot header for SQLite deserialization, and includes originals/preferences. Restore validates first into a fresh home and never overwrites a database. Credentials and Pi transcripts are excluded. Encryption/key management, complete privacy purge and protected-bank administration are not implemented.

Software validity does not prove learning efficacy. The policy's thresholds, intervals and combined adaptations remain engineering defaults to evaluate against a fair fixed comparator.
