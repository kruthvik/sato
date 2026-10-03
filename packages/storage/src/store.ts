import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CallSchema, DefineSchema, RecordSchema, validate, validTime, type Revision, type RevisionKind, type LearningEvent, type Goal, type TaskDefinition, type TaskInstance, type Rubric, type Attempt, type Assessment, type Assistance, type CallEntry } from "../../core/src/contracts.ts";
import { projectComponents } from "./projection.ts";
import { verifyLinearEquation } from "../../activities/src/validation.ts";

export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
interface RevisionRow { revision_id: string; entity_id: string; kind: RevisionKind; parent_revision_id: string | null; body: string; content_hash: string; created_at: string; created_seq: number }
interface EventRow extends Omit<LearningEvent, "payload"> { payload: string }
type DefineInput = { operation_id: string; kind: Exclude<RevisionKind, "source">; entity_id?: string; parent_revision_id?: string; expected_goal_revision_id?: string; body: Record<string, unknown> };
type RecordInput = { operation_id: string; kind: LearningEvent["kind"]; expected_goal_revision_id: string; occurred_at?: string; payload: Record<string, unknown> };

export class LearningStore {
  readonly db: Database;
  constructor(readonly filename: string, readonly now: () => string = () => new Date().toISOString()) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.db = new Database(filename, { create: true, strict: true });
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    const version = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > 1) { this.db.close(); throw new Error("Database is newer than this Sato version; upgrade Sato before opening it"); }
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS object_revision (
          revision_id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, kind TEXT NOT NULL,
          parent_revision_id TEXT REFERENCES object_revision(revision_id), schema_version INTEGER NOT NULL DEFAULT 1,
          body TEXT NOT NULL CHECK(json_valid(body)), content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
          created_seq INTEGER NOT NULL, operation_id TEXT UNIQUE NOT NULL, command_hash TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS revision_entity ON object_revision(entity_id, created_seq);
        CREATE TABLE IF NOT EXISTS event (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, operation_id TEXT UNIQUE NOT NULL,
          command_hash TEXT NOT NULL, kind TEXT NOT NULL, session_id TEXT NOT NULL, branch TEXT NOT NULL CHECK(branch IN ('real','hypothetical')),
          actor TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
          payload TEXT NOT NULL CHECK(json_valid(payload))
        );
        CREATE TABLE IF NOT EXISTS model_call_log (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('started','response','completed','failed','cancelled','unknown')),
          recorded_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), UNIQUE(call_id, phase)
        );
        CREATE TABLE IF NOT EXISTS projection (
          key TEXT PRIMARY KEY, through_seq INTEGER NOT NULL, as_of_time TEXT NOT NULL, version TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE TABLE IF NOT EXISTS blob_manifest (
          hash TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source_span (
          span_id TEXT PRIMARY KEY, source_revision_id TEXT NOT NULL REFERENCES object_revision(revision_id),
          ordinal INTEGER NOT NULL, locator TEXT NOT NULL, text TEXT NOT NULL, method TEXT NOT NULL, confidence REAL NOT NULL,
          UNIQUE(source_revision_id, ordinal)
        );
        CREATE TABLE IF NOT EXISTS job (
          job_id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL, state TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0, error TEXT, body TEXT NOT NULL CHECK(json_valid(body))
        );
        PRAGMA user_version=1;
      `);
      for (const table of ["object_revision", "event", "model_call_log", "blob_manifest", "source_span"]) {
        this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'Immutable record'); END;
          CREATE TRIGGER IF NOT EXISTS ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'Immutable record; privacy purge requires an explicit maintenance operation'); END;`);
      }
    })();
  }
  get throughSeq(): number { return (this.db.query("SELECT COALESCE(MAX(seq),0) AS seq FROM event").get() as { seq: number }).seq; }
  revisions(kind?: RevisionKind, throughSeq = this.throughSeq): Revision[] {
    const rows = this.db.query<RevisionRow, [number, string | null, string | null]>("SELECT * FROM object_revision WHERE created_seq<=? AND (? IS NULL OR kind=?) ORDER BY created_seq,revision_id").all(throughSeq, kind ?? null, kind ?? null);
    return rows.map(row => ({ ...row, body: JSON.parse(row.body) }));
  }
  revision<T = Record<string, unknown>>(id: string, kind?: RevisionKind): Revision<T> {
    const row = this.db.query<RevisionRow, [string]>("SELECT * FROM object_revision WHERE revision_id=?").get(id);
    if (!row || (kind && row.kind !== kind)) throw new Error(`Missing ${kind ?? "object"} revision: ${id}`);
    return { ...row, body: JSON.parse(row.body) };
  }
  currentGoal(throughSeq = this.throughSeq): Revision<Goal> | undefined { return this.revisions("goal", throughSeq).at(-1) as Revision<Goal> | undefined; }
  events(throughSeq = this.throughSeq): LearningEvent[] {
    return this.db.query<EventRow, [number]>("SELECT * FROM event WHERE seq<=? ORDER BY seq").all(throughSeq).map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  event<T = Record<string, unknown>>(id: string, kind?: LearningEvent["kind"]): LearningEvent<T> {
    const row = this.db.query<EventRow, [string]>("SELECT * FROM event WHERE event_id=?").get(id);
    if (!row || (kind && row.kind !== kind)) throw new Error(`Missing ${kind ?? "event"}: ${id}`);
    return { ...row, payload: JSON.parse(row.payload) };
  }
  private checkGoal(expected?: string): void {
    const current = this.currentGoal();
    if (current && expected !== current.revision_id) throw new Error(`Stale goal: refresh learning_context; current revision is ${current.revision_id}`);
    if (!current && expected) throw new Error("No active goal");
  }
  private duplicate(table: "event" | "object_revision", operationId: string, input: unknown): string | undefined {
    const row = this.db.query<{ id: string; command_hash: string }, [string]>(`SELECT ${table === "event" ? "event_id" : "revision_id"} AS id,command_hash FROM ${table} WHERE operation_id=?`).get(operationId);
    if (row && row.command_hash !== hash(canonical(input))) throw new Error("Idempotency key was already used with different content");
    return row?.id;
  }
  append(kind: LearningEvent["kind"], payload: Record<string, unknown>, operationId: string, actor: string, sessionId: string, occurredAt = this.now(), command: unknown = { kind, payload }, branch: "real" | "hypothetical" = "real"): LearningEvent {
    const existing = this.duplicate("event", operationId, command);
    if (existing) return this.event(existing);
    const recordedAt = validTime(this.now());
    const occurred = validTime(occurredAt);
    if (Date.parse(occurred) > Date.parse(recordedAt) + 60000) throw new Error("Future events cannot establish learning evidence");
    const eventId = randomUUID();
    this.db.query("INSERT INTO event(event_id,operation_id,command_hash,kind,session_id,branch,actor,occurred_at,recorded_at,payload) VALUES(?,?,?,?,?,?,?,?,?,?)").run(eventId, operationId, hash(canonical(command)), kind, sessionId, branch, actor, occurred, recordedAt, canonical(payload));
    return this.event(eventId);
  }
  define(rawInput: unknown, actor = "pi", sessionId = "local"): Revision {
    validate<DefineInput>(DefineSchema, rawInput);
    return this.db.transaction(() => {
      let input = rawInput;
      const existing = this.duplicate("object_revision", input.operation_id, input);
      if (existing) return this.revision(existing);
      this.checkGoal(input.expected_goal_revision_id);
      if (input.parent_revision_id) {
        const parent = this.revision(input.parent_revision_id, input.kind);
        if (input.entity_id && parent.entity_id !== input.entity_id) throw new Error("Parent belongs to a different entity");
        input = { ...input, entity_id: parent.entity_id };
        const latest = this.revisions(input.kind).filter(r => r.entity_id === parent.entity_id).at(-1);
        if (latest?.revision_id !== parent.revision_id) throw new Error("Stale parent revision");
      } else if (input.entity_id && this.revisions().some(r => r.entity_id === input.entity_id)) throw new Error("Existing entities require a parent revision");
      if (input.kind === "task_definition" && ["candidate", "needs_review"].includes(input.body.status as string) && verifyLinearEquation(input.body as unknown as TaskDefinition)) {
        input = { ...input, body: { ...input.body, status: "practice_ready", review: { method: "deterministic", reason: "Independent bounded linear-equation calculator verified the key; no semantic or psychometric equivalence claim" } } };
      }
      this.validateDefinition(input.kind, input.body, actor);
      const revisionId = randomUUID();
      const created = this.append("decision", { action: "revision_defined", kind: input.kind, revision_id: revisionId, reason: "Accepted immutable proposal", evidence_event_ids: [] }, `define:${input.operation_id}`, actor, sessionId);
      this.insertRevision(revisionId, input.entity_id ?? randomUUID(), input.kind, input.parent_revision_id ?? null, input.body, created.seq, input.operation_id, rawInput);
      if (input.kind === "task_instance") {
        this.append("task_delivered", { instance_revision_id: revisionId }, `deliver:${input.operation_id}`, actor, sessionId);
      }
      this.rebuild();
      return this.revision(revisionId);
    })();
  }
  insertRevision(revisionId: string, entityId: string, kind: RevisionKind, parent: string | null, body: Record<string, unknown>, seq: number, operationId: string, command: unknown): void {
    const encoded = canonical(body);
    this.db.query("INSERT INTO object_revision(revision_id,entity_id,kind,parent_revision_id,body,content_hash,created_at,created_seq,operation_id,command_hash) VALUES(?,?,?,?,?,?,?,?,?,?)").run(revisionId, entityId, kind, parent, encoded, hash(encoded), this.now(), seq, operationId, hash(canonical(command)));
  }
  private validateDefinition(kind: RevisionKind, body: Record<string, unknown>, actor: string): void {
    const refs = (key: string, refKind: RevisionKind) => { for (const ref of (body[key] as string[] | undefined) ?? []) this.revision(ref, refKind); };
    if (kind === "goal") {
      const current = this.currentGoal();
      if (actor === "pi" && (!current || body.provider_sharing !== current.body.provider_sharing || canonical(body.source_ids) !== canonical(current.body.source_ids))) throw new Error("Provider consent and source selection require learner controls");
      if (body.deadline) validTime(body.deadline as string);
      for (const source of body.source_ids as string[]) this.revision(source, "source");
    }
    if (kind === "component") { refs("concept_revision_ids", "concept"); refs("prerequisite_revision_ids", "component"); }
    if (kind === "task_family") refs("lineage_revision_ids", "task_family");
    if (kind === "plan") { this.revision(body.goal_revision_id as string, "goal"); refs("component_revision_ids", "component"); }
    if (kind === "rubric" || kind === "task_definition") {
      for (const span of body.source_span_ids as string[]) this.acceptedSpan(span);
    }
    if (kind === "rubric") {
      const dimensions = (body as unknown as Rubric).dimensions.map(d => d.name);
      if (new Set(dimensions).size !== dimensions.length) throw new Error("Rubric dimensions must be unique");
    }
    if (kind === "task_definition") {
      const task = body as unknown as TaskDefinition;
      this.revision(task.family_revision_id, "task_family"); this.revision(task.rubric_revision_id, "rubric"); refs("component_revision_ids", "component");
      if (task.scoring !== "rubric" && !task.answer) throw new Error("Objective scoring requires an answer");
      if (task.scoring === "numeric" && (!Number.isFinite(Number(task.answer)) || task.answer?.trim() === "")) throw new Error("Numeric key must be a finite number");
      if (task.status === "practice_ready" && task.review.method === "unreviewed") throw new Error("Review is required before practice");
      if (actor === "pi" && task.status === "practice_ready" && !(task.review.method === "deterministic" && verifyLinearEquation(task))) throw new Error("Pi cannot self-certify review. Save a candidate for /approve");
      if (task.stakes === "high" && task.status === "practice_ready" && task.review.method !== "human") throw new Error("High-stakes tasks require human review");
      if (task.partition === "protected" && actor === "pi") throw new Error("Tutor cannot author the protected outcome bank");
      if (task.answer && task.answer.trim().length > 3 && task.prompt.toLowerCase().includes(task.answer.trim().toLowerCase())) throw new Error("Answer appears in prompt; revise before use");
      const duplicate = this.revisions("task_definition").find(r => r.body.prompt === task.prompt && r.body.family_revision_id !== task.family_revision_id);
      if (duplicate) throw new Error("Identical prompt is already assigned to another family");
    }
    if (kind === "task_instance") {
      const instance = body as unknown as TaskInstance;
      this.revision(instance.goal_revision_id, "goal");
      this.checkGoal(instance.goal_revision_id);
      const task = this.revision<TaskDefinition>(instance.definition_revision_id, "task_definition");
      if (task.body.status !== "practice_ready") throw new Error("Task is not reviewed and ready");
      const latest = this.revisions("task_definition").filter(r => r.entity_id === task.entity_id).at(-1);
      if (latest?.revision_id !== task.revision_id) throw new Error("Task definition was superseded");
      for (const span of task.body.source_span_ids) this.acceptedSpan(span);
      if (task.body.partition === "protected" && actor === "pi") throw new Error("Protected task delivery requires the explicit assessment control");
      if (task.body.partition === "protected") {
        const familyEntities = (revisionId: string, seen = new Set<string>()): Set<string> => {
          if (seen.has(revisionId)) return new Set();
          seen.add(revisionId);
          const family = this.revision(revisionId, "task_family");
          const entities = new Set([family.entity_id]);
          for (const related of (family.body.lineage_revision_ids as string[]) ?? []) for (const entity of familyEntities(related, seen)) entities.add(entity);
          return entities;
        };
        const sourceEntities = (spans: string[]) => new Set(spans.map(span => {
          const row = this.db.query<{ source_revision_id: string }, [string]>("SELECT source_revision_id FROM source_span WHERE span_id=?").get(span);
          if (!row) throw new Error("Missing historical source span");
          return this.revision(row.source_revision_id, "source").entity_id;
        }));
        const protectedFamilies = familyEntities(task.body.family_revision_id);
        const protectedSources = sourceEntities(task.body.source_span_ids);
        const knownSources = this.revisions("goal").flatMap(goal => goal.body.source_ids as string[]).map(id => this.revision(id, "source").entity_id);
        if (knownSources.some(id => protectedSources.has(id))) throw new Error("Learner already selected this assessment source; cannot claim an unseen source");
        const delivered = this.events().filter(e => e.kind === "task_delivered");
        for (const e of delivered) {
          const prior = this.revision<TaskInstance>(e.payload.instance_revision_id as string);
          const def = this.revision<TaskDefinition>(prior.body.definition_revision_id).body;
          const priorFamilies = familyEntities(def.family_revision_id);
          const priorSources = sourceEntities(def.source_span_ids);
          if ([...priorFamilies].some(id => protectedFamilies.has(id)) || [...priorSources].some(id => protectedSources.has(id))) throw new Error("Protected assessment overlaps a delivered family/source; cannot claim independent transfer");
        }
      }
    }
  }
  acceptedSpan(spanId: string): { span_id: string; source_revision_id: string; text: string; locator: string } {
    const span = this.db.query<{ span_id: string; source_revision_id: string; text: string; locator: string }, [string]>("SELECT * FROM source_span WHERE span_id=?").get(spanId);
    if (!span) throw new Error(`Missing source span: ${spanId}`);
    const source = this.revision(span.source_revision_id, "source");
    const latest = this.revisions("source").filter(r => r.entity_id === source.entity_id).at(-1);
    if (latest?.revision_id !== source.revision_id || this.sourceStatus(source.revision_id) !== "indexed") throw new Error("Source is removed, superseded or not accepted");
    return span;
  }
  sourceStatus(revisionId: string, throughSeq = this.throughSeq): string {
    let status = "received";
    for (const e of this.events(throughSeq)) if (e.payload.source_revision_id === revisionId && ["source_status", "source_accepted", "source_removed"].includes(e.kind)) status = e.payload.status as string;
    return status;
  }
  record(input: unknown, sessionId: string): LearningEvent {
    validate<RecordInput>(RecordSchema, input);
    return this.db.transaction(() => {
      const existing = this.duplicate("event", input.operation_id, input);
      if (existing) return this.event(existing);
      this.checkGoal(input.expected_goal_revision_id);
      const payload = { ...input.payload };
      let occurred = validTime(input.occurred_at ?? this.now());
      if (input.kind === "attempt_submitted") {
        const attempt = payload as unknown as Attempt;
        const instance = this.revision<TaskInstance>(attempt.instance_revision_id, "task_instance");
        if (this.revision(instance.body.goal_revision_id, "goal").entity_id !== this.revision(input.expected_goal_revision_id, "goal").entity_id) throw new Error("Attempt belongs to a different goal");
        const response = this.event<{ text: string }>(attempt.response_event_id, "learner_response");
        const delivered = this.events().find(e => e.kind === "task_delivered" && e.payload.instance_revision_id === attempt.instance_revision_id);
        if (!delivered || response.seq <= delivered.seq) throw new Error("Response must follow task delivery");
        if (response.session_id !== sessionId) throw new Error("Response belongs to a different conversation");
        if (this.events().some(e => e.kind === "attempt_submitted" && (e.payload.attempt_id === attempt.attempt_id || e.payload.response_event_id === attempt.response_event_id))) throw new Error("Attempt/response was already recorded; do not duplicate evidence");
        payload.response = response.payload.text;
        occurred = response.occurred_at;
      }
      if (input.kind === "step_attempt") {
        const attempt = this.findAttempt(payload.attempt_id as string);
        this.event(payload.response_event_id as string, "learner_response");
        for (const id of payload.prior_step_ids as string[]) if (!this.events().some(e => e.kind === "step_attempt" && e.payload.step_attempt_id === id && e.payload.attempt_id === attempt.payload.attempt_id)) throw new Error("Invalid dependent step");
        if (this.events().some(e => e.kind === "step_attempt" && e.payload.step_attempt_id === payload.step_attempt_id)) throw new Error("Step already exists");
      }
      if (input.kind === "assistance") {
        const help = payload as unknown as Assistance;
        const instance = this.revision<TaskInstance>(help.instance_revision_id, "task_instance");
        if (this.revision(instance.body.goal_revision_id, "goal").entity_id !== this.revision(input.expected_goal_revision_id, "goal").entity_id) throw new Error("Assistance belongs to another goal");
        if (help.attempt_id && this.findAttempt(help.attempt_id).payload.instance_revision_id !== help.instance_revision_id) throw new Error("Assistance attempt mismatch");
        for (const ref of help.component_revision_ids) this.revision(ref, "component");
        if (help.kind === "reveal" && !help.answer_bearing) throw new Error("A revealed solution is answer-bearing assistance");
        if (help.step_attempt_id && !this.events().some(e => e.kind === "step_attempt" && e.payload.step_attempt_id === help.step_attempt_id && e.payload.attempt_id === help.attempt_id)) throw new Error("Assistance step scope mismatch");
        const stages = this.events().filter(e => e.kind === "assistance" && e.payload.assistance_id === help.assistance_id);
        if (stages.some(e => e.payload.stage === help.stage)) throw new Error("Assistance stage already recorded");
        if (stages.some(e => e.payload.instance_revision_id !== help.instance_revision_id || e.payload.content !== help.content || e.payload.answer_bearing !== help.answer_bearing)) throw new Error("Assistance lifecycle content/scope cannot change");
      }
      if (input.kind === "assessment") {
        const assessment = payload as unknown as Assessment;
        const attempt = this.findAttempt(assessment.attempt_id);
        const instance = this.revision<TaskInstance>(attempt.payload.instance_revision_id, "task_instance");
        const task = this.revision<TaskDefinition>(instance.body.definition_revision_id, "task_definition").body;
        if (task.rubric_revision_id !== assessment.rubric_revision_id) throw new Error("Assessment must pin the delivered rubric");
        if (assessment.step_attempt_id && !this.events().some(e => e.kind === "step_attempt" && e.payload.step_attempt_id === assessment.step_attempt_id && e.payload.attempt_id === assessment.attempt_id)) throw new Error("Invalid step assessment");
        const rubric = this.revision<Rubric>(assessment.rubric_revision_id, "rubric").body;
        for (const score of assessment.scores) {
          const dim = rubric.dimensions.find(d => d.name === score.dimension);
          if (!dim || score.score > dim.max_score) throw new Error("Score does not match rubric bounds");
          if (task.scoring === "rubric" && !attempt.payload.response.includes(score.evidence)) throw new Error("Rubric evidence must quote an actual span of the learner response");
        }
        if (new Set(assessment.scores.map(s => s.dimension)).size !== assessment.scores.length) throw new Error("Duplicate scoring dimension");
        if (task.scoring === "rubric" && assessment.outcome === "success" && assessment.scores.length !== rubric.dimensions.length) throw new Error("A successful holistic assessment requires evidence for every rubric dimension");
        const previous = this.events().filter(e => e.kind === "assessment" && e.payload.attempt_id === assessment.attempt_id && e.payload.step_attempt_id === assessment.step_attempt_id).at(-1);
        if (previous && assessment.correction_of_event_id !== previous.event_id) throw new Error("Re-scoring requires a correction of the latest assessment");
        if (assessment.correction_of_event_id && previous?.event_id !== assessment.correction_of_event_id) throw new Error("Correction must target the latest assessment for the same whole response or step");
        if (assessment.correction_of_event_id && this.event(assessment.correction_of_event_id, "assessment").payload.attempt_id !== assessment.attempt_id) throw new Error("Correction must refer to the same attempt");
        if (!assessment.step_attempt_id && task.scoring !== "rubric") {
          const response = (attempt.payload as unknown as { response: string }).response.trim();
          const success = task.scoring === "numeric" ? response !== "" && Number.isFinite(Number(response)) && Math.abs(Number(response) - Number(task.answer)) <= (task.tolerance ?? 0) : response.toLocaleLowerCase() === task.answer?.trim().toLocaleLowerCase();
          payload.outcome = success ? "success" : "failure";
          payload.assessor = "deterministic";
          payload.scores = rubric.dimensions.map(d => ({ dimension: d.name, score: success ? d.max_score : 0, evidence: response }));
          payload.uncertainty = "Objective response match only; reasoning is not established by this score.";
        } else payload.assessor = "pi_rubric_proposal";
      }
      if (input.kind === "review_scheduled") {
        this.revision(payload.component_revision_id as string, "component");
        payload.due_at = validTime(payload.due_at as string);
        if (!payload.consent) throw new Error("Review scheduling requires learner consent");
        this.event(payload.consent_response_event_id as string, "learner_response");
      }
      if (input.kind === "checkpoint") {
        if (payload.goal_revision_id !== input.expected_goal_revision_id) throw new Error("Checkpoint goal mismatch");
      }
      if (input.kind === "decision") for (const ref of payload.evidence_event_ids as string[]) this.event(ref);
      if (input.kind === "review_completed") {
        const schedule = this.event(payload.schedule_event_id as string, "review_scheduled");
        const assessment = this.event<Assessment>(payload.assessment_event_id as string, "assessment");
        const attempt = this.findAttempt(assessment.payload.attempt_id);
        const instance = this.revision<TaskInstance>(attempt.payload.instance_revision_id).body;
        const task = this.revision<TaskDefinition>(instance.definition_revision_id).body;
        if (instance.purpose !== "retention" || !task.component_revision_ids.includes(schedule.payload.component_revision_id as string) || attempt.occurred_at < (schedule.payload.due_at as string)) throw new Error("Review completion requires a matching delayed retention attempt after its due date");
      }
      const event = this.append(input.kind, payload, input.operation_id, "pi", sessionId, occurred, input);
      if (input.kind === "assessment") {
        const attempt = this.findAttempt(payload.attempt_id as string);
        const instance = this.revision<TaskInstance>(attempt.payload.instance_revision_id).body;
        const task = this.revision<TaskDefinition>(instance.definition_revision_id).body;
        this.append("assistance", { assistance_id: `feedback:${event.event_id}`, instance_revision_id: attempt.payload.instance_revision_id, attempt_id: attempt.payload.attempt_id, component_revision_ids: task.component_revision_ids, stage: "possibly_exposed", kind: "feedback", content: payload.feedback, answer_bearing: true }, `feedback:${input.operation_id}`, "host", sessionId);
      }
      this.rebuild();
      return event;
    })();
  }
  findAttempt(attemptId: string): LearningEvent<Attempt & { response: string }> {
    const e = this.events().find(e => e.kind === "attempt_submitted" && e.payload.attempt_id === attemptId);
    if (!e) throw new Error(`Missing attempt: ${attemptId}`);
    return e as unknown as LearningEvent<Attempt & { response: string }>;
  }
  learnerResponse(text: string, sessionId: string, operationId = randomUUID()): LearningEvent {
    if (!text.trim() || text.length > 24000) throw new Error("Response must contain 1–24000 characters");
    return this.append("learner_response", { text }, operationId, "learner", sessionId);
  }
  logCall(input: unknown): void {
    validate<CallEntry>(CallSchema, input);
    if (input.phase !== "started" && !this.db.query("SELECT 1 FROM model_call_log WHERE call_id=? AND phase='started'").get(input.call_id)) throw new Error("Call has no observed request start");
    this.db.query("INSERT OR IGNORE INTO model_call_log(call_id,phase,recorded_at,body) VALUES(?,?,?,?)").run(input.call_id, input.phase, this.now(), canonical(input));
  }
  rebuild(asOfTime = this.events().at(-1)?.recorded_at ?? "1970-01-01T00:00:00.000Z"): void {
    const projection = projectComponents(this, this.throughSeq, validTime(asOfTime));
    this.db.query("INSERT INTO projection(key,through_seq,as_of_time,version,body) VALUES('components',?,?,?,?) ON CONFLICT(key) DO UPDATE SET through_seq=excluded.through_seq,as_of_time=excluded.as_of_time,version=excluded.version,body=excluded.body").run(this.throughSeq, asOfTime, "1", canonical(projection));
  }
  integrity(): string[] { return this.db.query("PRAGMA integrity_check").all().map(row => String((row as Record<string, unknown>).integrity_check)); }
  close(): void { this.db.close(); }
}
