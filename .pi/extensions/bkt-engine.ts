/**
 * evidence-engine — authoritative multidimensional learner model.
 *
 * The filename is retained for compatibility, but scalar BKT is no longer the
 * source of truth. Every update now flows through a validated append-only
 * LearningEventV1 and updates independent memory, understanding,
 * discrimination, application, transfer, representation, fluency,
 * independence, and calibration estimates.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	consumeAssessmentContext,
	createAssessmentContext,
	createLearningEvent,
	ingestLearningEvent,
	loadLearnerState,
	saveLearnerState,
	modeReadiness,
	type GapCase,
	readLearningEvents,
	type AssessmentContext,
	type AssistanceState,
	type EvidencePhase,
	type NoveltyType,
	type RepresentationType,
	type TaskType,
} from "../core/learning-events.ts";
import { selectNextAction, type ExamBlueprint, type SelectionResult } from "../core/action-selector.ts";
import { clearSessionMemoryController, getSessionMemoryController } from "../core/memory-controller.ts";
import { loadPolicy, type LearningMode } from "../core/policy.ts";

const MODES = [Type.Literal("teach"), Type.Literal("fast-learn"), Type.Literal("cram"), Type.Literal("project"), Type.Literal("assessment"), Type.Literal("maintenance"), Type.Literal("exam-drill")];
const PHASES = [Type.Literal("diagnostic"), Type.Literal("instruction"), Type.Literal("practice"), Type.Literal("assessment"), Type.Literal("review"), Type.Literal("external")];
const TASKS = ["exposure", "recognition", "cued-recall", "free-recall", "self-explanation", "discrimination", "prediction", "procedure", "representation-conversion", "analogy", "error-diagnosis", "near-transfer", "far-transfer", "simulation", "authentic-performance"] as const;
const REPRESENTATIONS = ["verbal", "symbolic", "graphical", "spatial", "procedural", "mixed"] as const;
const NOVELTIES = ["repeated", "isomorphic", "near-transfer", "far-transfer", "authentic"] as const;
const ASSISTANCE = ["none", "minimal", "guided", "worked-solution", "AI-performed"] as const;
const ASSESSABLE_NODE_TYPES = new Set(["concept", "fact", "procedure", "axiom", "derived", "transfer-target", "assessment-objective", "goal"]);
function mappedSkillScope(cwd: string, topic: string): { mapped: boolean; ids: string[] } {
	const graphName = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general";
	const file = path.join(cwd, "_learning", "graphs", `${graphName}.json`);
	if (!fs.existsSync(file)) return { mapped: false, ids: [] };
	try {
		const nodes: unknown = JSON.parse(fs.readFileSync(file, "utf-8")).nodes;
		if (!Array.isArray(nodes)) return { mapped: false, ids: [] };
		return { mapped: true, ids: nodes.filter((node) => node && ASSESSABLE_NODE_TYPES.has(node.type) && typeof node.id === "string").map((node) => node.id) };
	} catch { return { mapped: false, ids: [] }; }
}
const ERRORS = ["memory-failure", "missing-prerequisite", "conceptual-model-error", "misconception", "discrimination-error", "method-selection-error", "representation-error", "procedure-error", "execution-slip", "omitted-constraint", "prompt-misread", "time-pressure-failure", "communication-failure", "source-content-error", "grading-uncertainty"] as const;
const ERROR_ALIASES: Record<string, typeof ERRORS[number]> = {
	"memory-lapse": "memory-failure", "recall-failure": "memory-failure", "forgotten": "memory-failure",
	"prerequisite-gap": "missing-prerequisite", "missing-prerequisite-gap": "missing-prerequisite",
	"conceptual-error": "conceptual-model-error", "flawed-model": "conceptual-model-error",
	"false-belief": "misconception", "discrimination-confusion": "discrimination-error",
	"selection-error": "method-selection-error", "wrong-method": "method-selection-error",
	"representation-barrier": "representation-error", "translation-error": "representation-error",
	"procedural-error": "procedure-error", "procedure-failure": "procedure-error",
	"execution-error": "execution-slip", "careless-slip": "execution-slip",
	"missed-constraint": "omitted-constraint", "misread-prompt": "prompt-misread",
	"time-pressure": "time-pressure-failure", "communication-error": "communication-failure",
	"source-error": "source-content-error", "uncertain": "grading-uncertainty", "unclear": "grading-uncertainty",
};

function normalizeErrorCategory(value: string): typeof ERRORS[number] {
	const key = value.trim().toLowerCase().replace(/[_\s]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");
	if ((ERRORS as readonly string[]).includes(key)) return key as typeof ERRORS[number];
	return ERROR_ALIASES[key] || "grading-uncertainty";
}

function literals<T extends readonly string[]>(values: T) { return Type.Union(values.map((value) => Type.Literal(value)) as any); }
function sessionId(ctx: any): string { return ctx.sessionManager?.getSessionId?.() || "local-session"; }
function phase(value: string): EvidencePhase { return value === "learning" ? "practice" : value as EvidencePhase; }
function defaultTask(type: string): TaskType {
	if (type === "application") return "near-transfer";
	if (type === "recognition" || type === "cued-recall" || type === "free-recall" || type === "self-explanation") return type;
	return "near-transfer";
}
function eventHistory(cwd: string, topic: string, skill: string) {
	return readLearningEvents(cwd, topic).filter((event) => event.skillIds.includes(skill));
}
function stateSummary(topic: string, skillId: string, state: any, mode: LearningMode): string {
	const readiness = modeReadiness(state, mode);
	const dimensions = [
		["Memory", state.memoryAccessibility], ["Understanding", state.structuralUnderstanding],
		["Discrimination", state.discrimination], ["Application", state.application], ["Transfer", state.transfer],
		["Representation", state.representationFlexibility], ["Fluency", state.proceduralFluency],
		["Independence", state.scaffoldIndependence], ["Calibration", state.calibration],
	];
	const stabilityStr = state.memoryStabilityDays !== undefined ? `${state.memoryStabilityDays.toFixed(1)} days` : "uninitialized";
	const abilityStr = state.operationalAbility !== undefined ? `${state.operationalAbility >= 0 ? "+" : ""}${state.operationalAbility.toFixed(2)}` : "0.00";
	const assistStr = state.assistanceState !== undefined ? `${(state.assistanceState * 100).toFixed(0)}%` : "0%";
	const errorEntries = Object.entries(state.errorDistribution || {});
	const errorStr = errorEntries.length ? errorEntries.map(([k, v]) => `${k}: ${v}`).join(", ") : "none";

	return [
		`Skill: ${skillId}`,
		`Topic: ${topic}`,
		`Lifecycle: ${state.lifecycleState}`,
		`${readiness.label}: ${readiness.ready ? "YES ✓" : "NO"}`,
		...(readiness.missing.length ? [`Missing evidence: ${readiness.missing.join(", ")}`] : []),
		"",
		"Dimension estimates (mean ± uncertainty):",
		...dimensions.map(([label, value]: any) => `- ${label}: ${(value.mean * 100).toFixed(0)}% ± ${(value.uncertainty * 100).toFixed(0)} (${value.evidenceCount} event${value.evidenceCount === 1 ? "" : "s"})`),
		"",
		"State Parameters (Phase 1/2 Architecture):",
		`- Memory Stability (S): ${stabilityStr}`,
		`- Operational Ability (Theta): ${abilityStr}`,
		`- Assistance Dependence (A): ${assistStr}`,
		`- Error History: ${errorStr}`,
		`Open gaps: ${state.gapCases.filter((gap: any) => gap.status !== "cleared").length}`,
		`Legacy summary score: ${(state.legacyModelScore * 100).toFixed(1)}% (display only; never used as a mastery gate)`,
	].join("\n");
}


const ERROR_ROUTING: Record<typeof ERRORS[number], {
	rule: string;
	intervention: string;
	verification: string;
}> = {
	"memory-failure": {
		rule: "Access failure from lack of spacing or decay; structural model may be intact.",
		intervention: "Provide brief correction (not a full reteach), then schedule earlier spaced retrieval (10–30 min lag) to consolidate.",
		verification: "Unaided delayed recall probe after minimum intervening practice.",
	},
	"missing-prerequisite": {
		rule: "Learner lacks required schema/concept dependency needed to process target skill.",
		intervention: "Lock dependent target node in domain graph. Drop to prerequisite node and establish core intuition with worked example.",
		verification: "Successful independent retrieval/procedure on the prerequisite before unlocking target.",
	},
	"conceptual-model-error": {
		rule: "Flawed or inverted mental model of causal mechanism or relationship.",
		intervention: "Do not repeat the prior explanation. Switch modality: present alternate causal representation, intuitive analogy, and worked demonstration.",
		verification: "Learner explains mechanism in own words (self-explanation/Feynman inversion) on an isomorphic case.",
	},
	"misconception": {
		rule: "Active false belief or intuitive heuristic that produces systematic erroneous predictions.",
		intervention: "Present a concrete counterexample; elicit a prediction that creates cognitive dissonance; demonstrate contradiction; install corrected model.",
		verification: "Discrimination or prediction task contrasting the misconception against the correct principle.",
	},
	"discrimination-error": {
		rule: "Confusion between two perceptually or structurally similar concepts/methods.",
		intervention: "Side-by-side contrastive analysis of minimal pairs highlighting the critical distinguishing feature; mixed practice with unlabeled cases.",
		verification: "Mixed discrimination quiz correctly classifying alternating instances of both concepts.",
	},
	"method-selection-error": {
		rule: "Applying an otherwise valid procedure to a problem where conditions of applicability are unmet.",
		intervention: "Isolate structural decision cues. Practice 'classify-before-solve' drills where learner determines method without calculating.",
		verification: "Correct method selection across diverse problem presentations with mixed surface features.",
	},
	"representation-error": {
		rule: "Inability to translate between verbal, symbolic, graphical, or spatial forms.",
		intervention: "Explicit translation drill: map components of the verbal problem to the symbolic equation and visual graph.",
		verification: "Convert a novel problem across two distinct representation formats without assistance.",
	},
	"procedure-error": {
		rule: "Faulty step sequence, inverted operation order, or omitted algorithmic phase.",
		intervention: "Subgoal labeling with partially completed (completion) problem; fade scaffolding to independent execution.",
		verification: "Independent execution of full procedural sequence on a parallel problem.",
	},
	"execution-slip": {
		rule: "Mechanical/arithmetic slip despite sound mental model and correct procedure.",
		intervention: "Briefly flag the mechanical error; reinforce an explicit verification and checking checklist.",
		verification: "Unaided completion of isomorphic task with self-verification check applied.",
	},
	"omitted-constraint": {
		rule: "Overlooking a boundary condition, edge case, or problem constraint.",
		intervention: "Present boundary cases and non-examples where the omitted constraint causes catastrophic failure.",
		verification: "Identification of valid vs invalid application boundaries on 2+ non-examples.",
	},
	"prompt-misread": {
		rule: "Misinterpreting the question, confusing units, or answering a different question than asked.",
		intervention: "Prompt restatement drill: learner underlines given information, constraints, and target query before attempting.",
		verification: "Accurately restate question requirements on the next problem before solving.",
	},
	"time-pressure-failure": {
		rule: "Breakdown under time constraints; slow retrieval or inefficient search strategy.",
		intervention: "Fluency training: short burst retrieval drills to compress procedural latency, followed by timed simulation.",
		verification: "Timed performance meeting the target latency threshold on an isomorphic task.",
	},
	"communication-failure": {
		rule: "Concept understood internally but expressed ambiguously, incoherently, or using incorrect terminology.",
		intervention: "Rubric-guided feedback on clarity; run peer teach-back (Feynman student inversion) with emphasis on precise terms.",
		verification: "Clear, unambiguous explanation satisfying communication rubric criteria.",
	},
	"source-content-error": {
		rule: "Contradiction or inaccuracy originating in training materials or references.",
		intervention: "Quarantine faulty source text; launch researcher subagent to reconcile contradictory authorities.",
		verification: "Verified authoritative definition established and recorded in topic note.",
	},
	"grading-uncertainty": {
		rule: "Ambiguous learner response where automated or tutor grading cannot determine true intent.",
		intervention: "Prompt learner for clarification without revealing the correct answer; use analytic rubric with explicit criteria.",
		verification: "Clear constructed response evaluated against analytic rubric criteria.",
	},
};

export default function evidenceEngine(pi: ExtensionAPI) {
	let compatibilityContextToken: string | null = null;

	pi.on("session_shutdown", async (_event, ctx) => {
		clearSessionMemoryController(sessionId(ctx));
	});

	pi.registerTool({
		name: "tag_skill",
		label: "create assessment context",
		description: "Compatibility adapter that creates a one-use immutable assessment context for the next quiz. Prefer passing assessmentContext directly to quiz. A context cannot be reused.",
		promptSnippet: "Every graded attempt needs explicit topic, skill, task type, representation, novelty, mode, and phase metadata. Prefer quiz.assessmentContext; tag_skill is a one-use compatibility adapter only.",
		parameters: Type.Object({
			topic: Type.String(), skill: Type.String(), mode: Type.Optional(Type.Union(MODES as any)),
			evidenceType: Type.Optional(literals(["recognition", "cued-recall", "free-recall", "self-explanation", "application"] as const)),
			phase: Type.Optional(literals(["diagnostic", "learning", "instruction", "practice", "assessment", "review"] as const)),
			representation: Type.Optional(literals(REPRESENTATIONS)), novelty: Type.Optional(literals(NOVELTIES)),
			itemFamilyId: Type.Optional(Type.String()), parallelFormId: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const context = createAssessmentContext(cwd, {
				attemptId: crypto.randomUUID(), topicId: params.topic.trim(), skillIds: [params.skill.trim()],
				knowledgeObjectIds: [params.skill.trim()], mode: (params.mode || "teach") as LearningMode,
				phase: phase(params.phase || "practice"), taskType: defaultTask(params.evidenceType || "recognition"),
				representation: (params.representation || "verbal") as RepresentationType,
				novelty: (params.novelty || "repeated") as NoveltyType,
				itemFamilyId: params.itemFamilyId?.trim() || undefined, parallelFormId: params.parallelFormId?.trim() || undefined,
			});
			compatibilityContextToken = context.token;
			return { content: [{ type: "text" as const, text: `Created one-use assessment context ${context.token} for ${context.topicId}/${context.skillIds.join(", ")}. It will be consumed by the next quiz result.` }], details: context };
		},
	});

	pi.registerTool({
		name: "record_learning_evidence",
		label: "record learning evidence",
		description: "Atomically append a complete learning event and update multidimensional learner state, mastery evidence, calibration, and gap escrow.",
		promptSnippet: "Record every evaluated open response once with exact response, latency, assistance, novelty, and task metadata. Remediation does not clear its own gap; only an independent parallel or transfer attempt after separation can.",
		parameters: Type.Object({
			topic: Type.String(), skill: Type.String(), mode: Type.Union(MODES as any),
			evidenceType: Type.Optional(literals(["recognition", "cued-recall", "free-recall", "self-explanation", "application"] as const)),
			taskType: Type.Optional(literals(TASKS)), phase: Type.Union(PHASES as any),
			score: Type.Number({ minimum: 0, maximum: 1 }), prompt: Type.String(), response: Type.Optional(Type.Any()),
			attemptId: Type.Optional(Type.String()), parentAttemptId: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()),
			knowledgeObjectIds: Type.Optional(Type.Array(Type.String())), itemFamilyId: Type.Optional(Type.String()), parallelFormId: Type.Optional(Type.String()),
			startedAt: Type.Optional(Type.String()), submittedAt: Type.Optional(Type.String()), latencyMs: Type.Optional(Type.Integer({ minimum: 0 })),
			priorExposureAt: Type.Optional(Type.String()), confidenceBefore: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
			predictedScore: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), predictedLatencyMs: Type.Optional(Type.Integer({ minimum: 0 })),
			hints: Type.Optional(Type.Integer({ minimum: 0 })), maximumHintDepth: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })),
			assistanceState: Type.Optional(literals(ASSISTANCE)), representation: Type.Optional(literals(REPRESENTATIONS)), novelty: Type.Optional(literals(NOVELTIES)),
			sourceContext: Type.Optional(literals(["generated", "authoritative-bank", "learner-supplied", "external-human", "real-world"] as const)),
			errorCategory: Type.Optional(literals(ERRORS)), misconceptionIds: Type.Optional(Type.Array(Type.String())),
			contentVersion: Type.Optional(Type.String()), learnerId: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const now = params.submittedAt || new Date().toISOString();
			const started = params.startedAt || new Date(Date.parse(now) - (params.latencyMs || 0)).toISOString();
			const history = eventHistory(cwd, params.topic, params.skill);
			const previous = history.at(-1);
			const taskType = (params.taskType || defaultTask(params.evidenceType || "application")) as TaskType;
			const attemptId = params.attemptId || crypto.randomUUID();
			const event = createLearningEvent({
				learnerId: params.learnerId || "local-learner", sessionId: sessionId(ctx), attemptId,
				parentAttemptId: params.parentAttemptId, topicId: params.topic.trim(), skillIds: [params.skill.trim()],
				knowledgeObjectIds: params.knowledgeObjectIds?.length ? params.knowledgeObjectIds : [params.skill.trim()],
				taskId: params.taskId || `${params.topic}:${params.skill}:${taskType}:${attemptId}`, itemFamilyId: params.itemFamilyId,
				parallelFormId: params.parallelFormId, mode: params.mode as LearningMode, phase: params.phase as EvidencePhase,
				taskType, prompt: params.prompt.trim(), response: params.response ?? "[not supplied]", score: params.score,
				correct: params.score >= loadPolicy(cwd).successScore, startedAt: started, submittedAt: now,
				latencyMs: params.latencyMs ?? Math.max(0, Date.parse(now) - Date.parse(started)), priorExposureAt: params.priorExposureAt || previous?.submittedAt,
				priorIntervalMs: previous ? Math.max(0, Date.parse(started) - Date.parse(previous.submittedAt)) : undefined,
				priorEncounterCount: history.length, confidenceBefore: params.confidenceBefore, predictedScore: params.predictedScore,
				predictedLatencyMs: params.predictedLatencyMs, hintsRequested: params.hints || 0,
				maximumHintDepth: params.maximumHintDepth ?? Math.min(6, params.hints || 0), assistanceState: (params.assistanceState || ((params.hints || 0) ? "minimal" : "none")) as AssistanceState,
				feedbackIds: [], representation: (params.representation || "verbal") as RepresentationType,
				novelty: (params.novelty || "repeated") as NoveltyType, sourceContext: params.sourceContext || "generated",
				errorCategory: params.errorCategory, misconceptionIds: params.misconceptionIds, contentVersion: params.contentVersion || "unversioned",
			}, cwd);
			const result = ingestLearningEvent(cwd, event);
			if (!result.accepted) return { content: [{ type: "text" as const, text: `Evidence rejected: ${result.errors.join("; ")}` }], details: result, isError: true };
			const state = result.states[params.skill];
			const readiness = state ? modeReadiness(state, params.mode as LearningMode) : null;
			return { content: [{ type: "text" as const, text: result.duplicate ? `Evidence already recorded (${event.eventId}); no state was updated twice.` : `Evidence recorded (${event.eventId}). Lifecycle: ${state.lifecycleState}. ${readiness?.label}: ${readiness?.ready ? "YES" : `NO — missing ${readiness?.missing.join(", ")}`}. Open gaps: ${state.gapCases.filter((gap) => gap.status !== "cleared").length}.` }], details: result };
		},
	});

	pi.on("tool_result", async (toolEvent, ctx) => {
		if ((toolEvent as any).toolName !== "quiz") return;
		const details = (toolEvent as any).details;
		if (!details || details.status !== "answered") return;
		const cwd = (ctx as any).cwd || process.cwd();
		let assessment = details.assessmentContext as AssessmentContext | undefined;
		if (!assessment && compatibilityContextToken) {
			assessment = consumeAssessmentContext(cwd, compatibilityContextToken) || undefined;
			compatibilityContextToken = null;
		}
		if (!assessment) return;
		const history = readLearningEvents(cwd, assessment.topicId).filter((candidate) => candidate.skillIds.some((skill) => assessment!.skillIds.includes(skill)));
		const prior = history.at(-1);
		const submittedAt = details.submittedAt || new Date().toISOString();
		const startedAt = details.startedAt || submittedAt;
		const response = details.mode === "short-answer" ? details.userAnswer : details.answers;
		const event = createLearningEvent({
			learnerId: "local-learner", sessionId: sessionId(ctx), attemptId: assessment.attemptId,
			topicId: assessment.topicId, skillIds: assessment.skillIds, knowledgeObjectIds: assessment.knowledgeObjectIds,
			taskId: details.taskId || `quiz:${assessment.attemptId}`, itemFamilyId: assessment.itemFamilyId, parallelFormId: assessment.parallelFormId,
			mode: assessment.mode, phase: assessment.phase, taskType: assessment.taskType, prompt: details.question,
			response, score: details.correct && !details.dontKnow ? 1 : 0, correct: details.correct === true,
			startedAt, submittedAt, latencyMs: details.latencyMs ?? Math.max(0, Date.parse(submittedAt) - Date.parse(startedAt)),
			priorExposureAt: prior?.submittedAt, priorIntervalMs: prior ? Math.max(0, Date.parse(startedAt) - Date.parse(prior.submittedAt)) : undefined,
			priorEncounterCount: history.length, confidenceBefore: details.confidenceBefore, hintsRequested: 0, maximumHintDepth: 0,
			assistanceState: "none", feedbackIds: details.explanation ? ["quiz-explanation"] : [], feedbackShownAt: submittedAt,
			representation: assessment.representation, novelty: assessment.novelty, sourceContext: "generated",
			errorCategory: details.dontKnow ? "memory-failure" : details.correct ? undefined : assessment.taskType === "discrimination" ? "discrimination-error" : "conceptual-model-error",
			contentVersion: details.contentVersion || "quiz-v1",
		}, cwd);
		ingestLearningEvent(cwd, event);
	});

	pi.on("tool_result", async (event) => {
		if ((event as any).toolName !== "subagent") return;
		// A simulated student can expose explanation weaknesses, but it is never
		// learner evidence and therefore cannot update state or clear a gap.
	});

	pi.registerTool({
		name: "mastery", label: "learner state", description: "Inspect multidimensional evidence and explicit readiness gates for one skill.",
		parameters: Type.Object({ topic: Type.String(), skill: Type.String(), mode: Type.Optional(Type.Union(MODES as any)) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const state = loadLearnerState((ctx as any).cwd || process.cwd(), params.topic).skills[params.skill];
			if (!state) return { content: [{ type: "text" as const, text: `No evidence exists for ${params.topic}/${params.skill}.` }] };
			const mode = (params.mode || "teach") as LearningMode;
			return { content: [{ type: "text" as const, text: stateSummary(params.topic, params.skill, state, mode) }], details: { state, readiness: modeReadiness(state, mode) } };
		},
	});

	pi.registerTool({
		name: "mastery_report", label: "learner-state report", description: "Report separate learner dimensions, lifecycle, missing evidence, and unresolved gaps for every skill in a topic.",
		parameters: Type.Object({ topic: Type.String(), mode: Type.Optional(Type.Union(MODES as any)) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const topic = loadLearnerState(cwd, params.topic);
			const mode = (params.mode || "teach") as LearningMode;
			const { mapped, ids: scope } = mappedSkillScope(cwd, params.topic);
			const skillIds = [...new Set([...scope, ...Object.keys(topic.skills)])];
			const lines = [`Learning evidence report: ${params.topic}`, `Mode gate: ${mode}`, mapped ? `Mapped scope: ${scope.length} assessable skills` : "Scope not verified: save a domain graph before claiming topic-wide readiness.", ""];
			if (!skillIds.length) lines.push("No mapped skills or recorded evidence. Readiness is unknown, not achieved.");
			for (const skillId of skillIds) {
				const state = topic.skills[skillId];
				if (!state) { lines.push(`○ ${skillId}: UNTESTED — no independent evidence`); continue; }
				const ready = modeReadiness(state, mode);
				lines.push(`${ready.ready ? "✓" : "○"} ${skillId}: ${state.lifecycleState}; memory ${(state.memoryAccessibility.mean * 100).toFixed(0)}%, understanding ${(state.structuralUnderstanding.mean * 100).toFixed(0)}%, discrimination ${(state.discrimination.mean * 100).toFixed(0)}%, transfer ${(state.transfer.mean * 100).toFixed(0)}%${ready.missing.length ? `; missing ${ready.missing.join(", ")}` : ""}`);
			}
			const untested = skillIds.filter((id) => !topic.skills[id]);
			const unready = skillIds.filter((id) => topic.skills[id] && !modeReadiness(topic.skills[id], mode).ready);
			lines.push("", `Topic coverage: ${mapped && !untested.length && !unready.length && skillIds.length ? "all mapped gates satisfied (not durable mastery)" : "INCOMPLETE"}; untested ${untested.length}; unready ${unready.length}.`);
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { topic, scopeVerified: mapped, untested, unready } };
		},
	});

	pi.registerTool({
		name: "record_confidence", label: "record performance prediction", description: "Store a pre-performance prediction for later calibration. Confidence is never mastery evidence.",
		parameters: Type.Object({ topic: Type.String(), skill: Type.String(), confidence: Type.Number({ minimum: 1, maximum: 3 }), predictedScore: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), predictedLatencyMs: Type.Optional(Type.Integer({ minimum: 0 })) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const dir = path.join(cwd, "_learning", "predictions");
			fs.mkdirSync(dir, { recursive: true });
			const prediction = { id: crypto.randomUUID(), topic: params.topic, skill: params.skill, confidence: (params.confidence - 1) / 2, predictedScore: params.predictedScore, predictedLatencyMs: params.predictedLatencyMs, recordedAt: new Date().toISOString(), consumed: false };
			fs.appendFileSync(path.join(dir, "predictions-v1.jsonl"), `${JSON.stringify(prediction)}\n`, "utf-8");
			return { content: [{ type: "text" as const, text: "Prediction recorded for calibration. Pass it into the next evidence event; it did not change mastery." }], details: prediction };
		},
	});

	pi.registerTool({
		name: "diagnose_cold_start", label: "diagnose cold start", description: "Stop low-information diagnostics when no production evidence exists and route a novice to worked-example acquisition.",
		parameters: Type.Object({ topic: Type.String() }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const events = readLearningEvents((ctx as any).cwd || process.cwd(), params.topic).filter((event) => event.phase === "diagnostic");
			const production = events.some((event) => ["free-recall", "self-explanation", "procedure", "near-transfer", "far-transfer"].includes(event.taskType) && event.score > 0.35);
			const average = events.length ? events.reduce((sum, event) => sum + event.score, 0) / events.length : 0;
			const coldStart = !production && events.length <= 4 && average <= 0.35;
			return { content: [{ type: "text" as const, text: coldStart ? `Cold start detected: ${events.length} diagnostic event(s), ${(average * 100).toFixed(0)}% average, no production evidence. Stop probing; use a worked example, self-explanation, completion task, then an independent case.` : `Some usable prior schema exists: ${events.length} diagnostic event(s), ${(average * 100).toFixed(0)}% average, production evidence ${production ? "present" : "absent"}.` }], details: { coldStart, eventCount: events.length, average, production } };
		},
	});


	pi.registerTool({
		name: "diagnose_error",
		label: "diagnose error & prescribe repair",
		description:
			"For a meaningful learner error during structured study, classify it, record a tracked gap when learner state exists, and suggest a repair plus verification. The category accepts ordinary language and common aliases; it is normalized to the engine taxonomy. If evidence is insufficient, use grading-uncertainty.",
		promptSnippet:
			"Use diagnose_error for a meaningful, observed error in structured study when classifying it will change the repair. Call it once for that error, with the actual response and expected answer. errorCategory accepts canonical labels or plain phrases such as memory lapse, prerequisite gap, discrimination confusion, representation barrier, or procedure error. If evidence is insufficient, use grading-uncertainty. Do not call for a brief clarification or ordinary one-off question.",
		parameters: Type.Object({
			topic: Type.String({ description: "Topic identifier" }),
			skill: Type.String({ description: "Skill identifier" }),
			errorCategory: Type.String({ description: `Observed error category. Canonical values: ${ERRORS.join(", ")}. Plain-language aliases are accepted; when uncertain use grading-uncertainty.` }),
			learnerResponse: Type.String({ description: "The raw response given by the learner" }),
			expectedResponse: Type.String({ description: "The correct or expected response" }),
			context: Type.Optional(Type.String({ description: "Optional problem context or prompt details" })),
			misconceptionId: Type.Optional(Type.String({ description: "Identifier for a specific misconception if identified" })),
			severity: Type.Optional(literals(["low", "medium", "high", "critical"] as const)),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const reportedCategory = params.errorCategory.trim().slice(0, 120);
			const category = normalizeErrorCategory(reportedCategory);
			const routing = ERROR_ROUTING[category];

			const errorRecord = {
				id: crypto.randomUUID(),
				topic: params.topic.trim(),
				skill: params.skill.trim(),
				category,
				reportedCategory,
				categoryWasNormalized: reportedCategory.toLowerCase().replace(/[_\s]+/g, "-") !== category,
				learnerResponse: params.learnerResponse,
				expectedResponse: params.expectedResponse,
				context: params.context,
				misconceptionId: params.misconceptionId,
				diagnosedAt: new Date().toISOString(),
				prescribedIntervention: routing.intervention,
				requiredVerification: routing.verification,
			};

			const errorsDir = path.join(cwd, "_learning", "errors");
			fs.mkdirSync(errorsDir, { recursive: true });
			fs.appendFileSync(path.join(errorsDir, `${params.topic.trim()}.jsonl`), `${JSON.stringify(errorRecord)}\n`, "utf-8");

			const state = loadLearnerState(cwd, params.topic.trim());
			const skill = state.skills[params.skill.trim()];
			let recurrenceCount = 0;
			let severity: "low" | "medium" | "high" | "critical" = params.severity || "medium";

			if (skill && category !== "grading-uncertainty") {
				const existingGaps = skill.gapCases.filter((g) => g.category === category);
				recurrenceCount = existingGaps.length;
				if (!params.severity) {
					severity = recurrenceCount >= 3 ? "critical" : recurrenceCount === 2 ? "high" : recurrenceCount === 1 ? "medium" : "low";
				}
				const gap: GapCase = {
					gapId: crypto.randomUUID(),
					skillIds: [params.skill.trim()],
					originatingEventId: errorRecord.id,
					originatingAttemptId: errorRecord.id,
					originatingTaskId: `error:${params.skill}:${category}`,
					openedAt: errorRecord.diagnosedAt,
					category: category as any,
					severity,
					status: "open",
					repairInterventionIds: [routing.intervention],
					recurrenceCount,
				};
				skill.gapCases.push(gap);
				skill.unresolvedErrorIds.push(gap.gapId);
				if (params.misconceptionId) {
					skill.activeMisconceptionIds = [...new Set([...skill.activeMisconceptionIds, params.misconceptionId])];
				}
				saveLearnerState(cwd, state);
			}

			const lines = [
				`[Cognitive Diagnosis: ${category.toUpperCase()}]`,
				...(errorRecord.categoryWasNormalized ? [`Input category interpreted as: ${category}.`] : []),
				`Skill: ${params.skill.trim()} (Topic: ${params.topic.trim()})`,
				`Severity: ${severity} (Recurrence #${recurrenceCount + 1})`,
				``,
				`Pedagogical Rule:`,
				routing.rule,
				``,
				`Prescribed Intervention:`,
				routing.intervention,
				``,
				`Required Verification for Gap Clearance:`,
				routing.verification,
			];

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { errorRecord, routing, severity, recurrenceCount },
			};
		},
	});

	pi.registerTool({
		name: "cram_decision",
		label: "cram decision & KPIs",
		description:
			"Calculate research cram KPIs (research/cramming.md:465-481) and dynamic adaptive time allocations (implementations.md Section 11.1 & 11.2) across remaining minutes to balance retrieval, error repair, mixed practice, simulation, and sleep protection.",
		promptSnippet:
			"In cram mode, call cram_decision to recompute target value rankings and optimal time budgets based on cold retrieval accuracy, simulation results, and deadline urgency.",
		parameters: Type.Object({
			topic: Type.String(),
			targetDate: Type.Optional(Type.String({ description: "Target exam or presentation ISO timestamp" })),
			minutesAvailable: Type.Optional(Type.Integer({ description: "Total minutes available in this study block", minimum: 5, maximum: 1440 })),
			targetWeights: Type.Optional(Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 }))),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const events = readLearningEvents(cwd, params.topic);
			const state = loadLearnerState(cwd, params.topic);

			const coldEvents = events.filter((e) => e.phase === "diagnostic" || (!e.priorExposureAt && e.taskType.includes("recall")));
			const coldAccuracy = coldEvents.length ? coldEvents.reduce((s, e) => s + e.score, 0) / coldEvents.length : 0;

			const simEvents = events.filter((e) => e.taskType === "simulation" || e.taskType === "authentic-performance" ||
				(e.mode === "assessment" && e.phase === "assessment" && e.sessionId.startsWith("activity:")));
			const simScore = simEvents.length ? simEvents.reduce((s, e) => s + e.score, 0) / simEvents.length : 0;

			const transferEvents = events.filter((e) => e.taskType === "near-transfer" || e.taskType === "far-transfer");
			const transferScore = transferEvents.length ? transferEvents.reduce((s, e) => s + e.score, 0) / transferEvents.length : 0;

			const allGaps = Object.values(state.skills).flatMap((s) => s.gapCases);
			const recurringGaps = allGaps.filter((g) => g.recurrenceCount > 0);
			const errorRecurrenceRate = allGaps.length ? recurringGaps.length / allGaps.length : 0;

			const { mapped, ids: mappedIds } = mappedSkillScope(cwd, params.topic);
			const skillIds = [...new Set([...mappedIds, ...Object.keys(state.skills)])];
			const skillEntries = Object.entries(state.skills);
			const readyIds = skillIds.filter((id) => state.skills[id] && modeReadiness(state.skills[id], "cram").ready);
			const readySkills = readyIds.length;
			const weights = params.targetWeights as Record<string, number> | undefined;
			const weightOf = (id: string) => weights?.[id] ?? 1;
			const totalWeight = skillIds.reduce((sum, id) => sum + weightOf(id), 0);
			const weightedCoverage = mapped && totalWeight > 0 ? readyIds.reduce((sum, id) => sum + weightOf(id), 0) / totalWeight : 0;

			const calibratedEvents = events.filter((e) => e.confidenceBefore !== undefined);
			const calibrationGap = calibratedEvents.length
				? calibratedEvents.reduce((s, e) => s + (e.confidenceBefore! - e.score), 0) / calibratedEvents.length
				: 0;

			const successEvents = events.filter((e) => e.correct && e.latencyMs > 0);
			const avgLatencyMs = successEvents.length
				? successEvents.reduce((s, e) => s + e.latencyMs, 0) / successEvents.length
				: 0;

			const aidedEvents = events.filter((e) => e.assistanceState !== "none");
			const unaidedEvents = events.filter((e) => e.assistanceState === "none");
			const aidedAvg = aidedEvents.length ? aidedEvents.reduce((s, e) => s + e.score, 0) / aidedEvents.length : 0;
			const unaidedAvg = unaidedEvents.length ? unaidedEvents.reduce((s, e) => s + e.score, 0) / unaidedEvents.length : 0;
			const unaidedToAidedGap = Math.max(0, aidedAvg - unaidedAvg);

			let totalMinutes = params.minutesAvailable || 120;
			if (params.targetDate) {
				const msUntil = Date.parse(params.targetDate) - Date.now();
				if (msUntil > 0) {
					totalMinutes = Math.min(totalMinutes, Math.floor(msUntil / 60000));
				}
			}

			let acquisitionMin = 0;
			let retrievalMin = 0;
			let repairMin = 0;
			let mixedMin = 0;
			let simMin = 0;
			const restBufferMin = Math.max(5, Math.round(totalMinutes * 0.1));

			const workMinutes = totalMinutes - restBufferMin;
			if (workMinutes <= 30) {
				// Even short sessions need a causal foothold and a representative final check.
				acquisitionMin = weightedCoverage < 0.75 ? Math.round(workMinutes * 0.25) : 0;
				retrievalMin = Math.round(workMinutes * (weightedCoverage < 0.75 ? 0.30 : 0.35));
				repairMin = Math.round(workMinutes * (weightedCoverage < 0.75 ? 0.25 : 0.20));
				mixedMin = weightedCoverage >= 0.75 ? Math.round(workMinutes * 0.15) : 0;
				simMin = Math.round(workMinutes * (weightedCoverage < 0.75 ? 0.20 : 0.30));
			} else if (weightedCoverage >= 0.75) {
				acquisitionMin = 0;
				retrievalMin = Math.round(workMinutes * 0.2);
				repairMin = Math.round(workMinutes * 0.2);
				mixedMin = Math.round(workMinutes * 0.3);
				simMin = Math.round(workMinutes * 0.3);
			} else {
				acquisitionMin = Math.round(workMinutes * 0.2);
				retrievalMin = Math.round(workMinutes * 0.35);
				repairMin = Math.round(workMinutes * 0.25);
				mixedMin = Math.round(workMinutes * 0.15);
				simMin = Math.round(workMinutes * 0.05);
			}
			retrievalMin += (workMinutes - (acquisitionMin + retrievalMin + repairMin + mixedMin + simMin));

			const rankedTargets = skillIds.map((skillId) => {
				const s = state.skills[skillId];
				const weakness = s ? 1 - s.memoryAccessibility.mean : 1;
				const userWeight = (params.targetWeights as any)?.[skillId] ?? 1;
				const openGapsCount = s?.gapCases.filter((g) => g.status !== "cleared").length || 0;
				const targetValue = Number((userWeight * weakness * (1 + openGapsCount * 0.5)).toFixed(3));
				return { skillId, targetValue, lifecycle: s?.lifecycleState || "UNTESTED", openGaps: openGapsCount };
			}).sort((a, b) => b.targetValue - a.targetValue);

			const kpiLines = [
				`=== CRAM CONTROL SYSTEM: ${params.topic} ===`,
				`Total Time Budget: ${totalMinutes} min (Rest/Buffer: ${restBufferMin} min)`,
				``,
				`Cram KPIs (research/cramming.md):`,
				`- Cold Retrieval Accuracy: ${coldEvents.length ? `${(coldAccuracy * 100).toFixed(1)}%` : "NOT TESTED"}`,
				`- Representative Performance Score: ${simEvents.length ? `${(simScore * 100).toFixed(1)}%` : "NOT TESTED"}`,
				`- Transfer Score: ${transferEvents.length ? `${(transferScore * 100).toFixed(1)}%` : "NOT TESTED"}`,
				`- Error Recurrence Rate: ${(errorRecurrenceRate * 100).toFixed(1)}%`,
				`- Weighted Mapped Target Coverage: ${mapped ? `${(weightedCoverage * 100).toFixed(1)}% (${readySkills}/${skillIds.length} skills deadline-ready)` : "UNKNOWN — save a domain graph before claiming coverage"}`, 
				`- Calibration Gap: ${(calibrationGap * 100).toFixed(1)}% (${calibrationGap > 0.1 ? "Overconfident" : calibrationGap < -0.1 ? "Underconfident" : "Well-Calibrated"})`,
				`- Avg Retrieval Latency: ${(avgLatencyMs / 1000).toFixed(1)}s`,
				`- Unaided-to-Aided Gap: ${(unaidedToAidedGap * 100).toFixed(1)}%`,
				``,
				`Dynamic Allocation:`,
				`- Acquisition: ${acquisitionMin} min`,
				`- High-Yield Retrieval: ${retrievalMin} min`,
				`- Error & Gap Repair: ${repairMin} min`,
				`- Mixed Interleaved Practice: ${mixedMin} min`,
				`- Representative Simulation: ${simMin} min`,
				`- Consolidation Buffer: ${restBufferMin} min`,
				``,
				`Priority Target Queue:`,
				...rankedTargets.slice(0, 5).map((t, i) => `${i + 1}. ${t.skillId} [Value: ${t.targetValue}, Gaps: ${t.openGaps}, State: ${t.lifecycle}]`),
			];

			let optimalCramAction: SelectionResult | undefined = undefined;
			if (skillEntries.length > 0) {
				const cramBlueprint: ExamBlueprint = {
					topic: params.topic,
					targetDeadline: params.targetDate || null,
					sessionMinutesRemaining: workMinutes,
					protectedBufferMinutes: restBufferMin,
					masteryThreshold: 0.7,
					kcs: skillIds.map((skillId) => ({
						id: skillId,
						weight: (params.targetWeights as Record<string, number> | undefined)?.[skillId] ?? (1 / Math.max(1, skillIds.length)),
						targetReadiness: 0.7,
					})),
				};
				const syntheticGraph = {
					version: 2 as const,
					topic: params.topic,
					nodes: skillIds.map((skillId) => ({ id: skillId, label: skillId, type: "concept" as const })),
					edges: [],
					lastUpdated: new Date().toISOString(),
				};
				optimalCramAction = selectNextAction(
					state,
					cramBlueprint,
					syntheticGraph,
					new Date(),
					undefined,
					getSessionMemoryController(sessionId(ctx)),
				);
			}

			if (optimalCramAction && !optimalCramAction.haltedForBuffer) {
				kpiLines.push(
					``,
					`Optimal Next Action (Rate-of-Gain Optimizer):`,
					`→ [ACTION: ${optimalCramAction.action.actionType}] ${optimalCramAction.action.itemTitle}`,
					`  Rate: ${optimalCramAction.rateOfGain.toFixed(3)} gain/min | Propensity: ${(optimalCramAction.propensity * 100).toFixed(1)}%`,
					`  Reason Codes: ${optimalCramAction.reasonCodes.join(", ") || "CRAM_PRIORITY"}`,
				);
			} else if (optimalCramAction?.haltedForBuffer) {
				kpiLines.push(
					``,
					`Optimal Next Action: [ACTION: STOP_AND_PREPARE]`,
					`  Reason: Protected exam buffer reached. Terminate study and rest.`,
				);
			}

			return {
				content: [{ type: "text" as const, text: kpiLines.join("\n") }],
				details: {
					kpis: { coldAccuracy, simScore, transferScore, errorRecurrenceRate, weightedCoverage, calibrationGap, avgLatencyMs, unaidedToAidedGap },
					allocation: { acquisitionMin, retrievalMin, repairMin, mixedMin, simMin, restBufferMin },
					rankedTargets,
					optimalAction: optimalCramAction,
				},
			};
		},
	});

	pi.registerTool({
		name: "simulate_assessment",
		label: "assessment declaration",
		description:
			"Record an assessment plan: target skills, environment, permitted aids and time limit. This declaration does not launch questions, enforce a timer or block conversational hints; administer an independent simulation separately and record only observed performance.",
		promptSnippet:
			"Before a high-stakes readiness check, use simulate_assessment to declare conditions, then deliver an unseen Activity Studio simulation. Do not offer hints until submission. The declaration alone is never evidence of independent performance.",
		parameters: Type.Object({
			topic: Type.String(),
			assessmentType: literals(["cold-diagnostic", "immediate-unseen", "delayed-retention", "delayed-transfer", "full-simulation"] as const),
			environment: literals(["closed-book", "formula-sheet-only", "calculator-allowed", "documentation-allowed", "unrestricted"] as const),
			timeLimitMinutes: Type.Integer({ minimum: 1, maximum: 300 }),
			skills: Type.Array(Type.String(), { minItems: 1 }),
			permittedAids: Type.Optional(Type.Array(Type.String())),
			instructions: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const assessmentId = crypto.randomUUID();
			const startedAt = new Date().toISOString();
			const dir = path.join(cwd, "_learning", "assessments");
			fs.mkdirSync(dir, { recursive: true });

			const record = {
				id: assessmentId,
				topic: params.topic.trim(),
				type: params.assessmentType,
				environment: params.environment,
				timeLimitMinutes: params.timeLimitMinutes,
				skills: params.skills,
				permittedAids: params.permittedAids || [],
				instructions: params.instructions || "Complete without conversational hints. Feedback is withheld until section completion.",
				status: "declared",
				startedAt,
			};

			fs.writeFileSync(path.join(dir, `${assessmentId}.json`), JSON.stringify(record, null, 2), "utf-8");

			const lines = [
				`=== ASSESSMENT CONDITIONS DECLARED ===`,
				`Assessment ID: ${assessmentId}`,
				`Type: ${params.assessmentType}`,
				`Environment: ${params.environment}`,
				`Time Limit: ${params.timeLimitMinutes} minutes`,
				`Target Skills: ${params.skills.join(", ")}`,
				`Permitted Aids: ${params.permittedAids?.length ? params.permittedAids.join(", ") : "None specified"}`,
				``,
				`This is a declaration, not a running proctor or test. Launch an unseen Activity Studio simulation separately, withhold hints until submission, then inspect actual independent responses.`,
				`Do not claim readiness from this record alone.`, 
			];

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: record,
			};
		},
	});

	pi.registerTool({
		name: "ingest_external_evidence",
		label: "ingest external performance evidence",
		description:
			"Ingest authentic external outcomes (real exam scores, code review feedback, human teacher rubric results, certification trials) into the learner model (implementations.md Section 14.1 & 14.2). If external outcomes contradict internal estimates, automatically raises uncertainty and opens model discrepancy cases.",
		promptSnippet:
			"When real-world exam, project, or teacher feedback is available, ingest it via ingest_external_evidence. Authentic external performance takes precedence over model predictions.",
		parameters: Type.Object({
			topic: Type.String(),
			skill: Type.String(),
			sourceType: literals(["exam-result", "teacher-rubric", "code-review", "human-mentor", "production-outcome", "certification"] as const),
			score: Type.Number({ minimum: 0, maximum: 1 }),
			evaluator: Type.String({ description: "Source authority or evaluator name/organization" }),
			feedback: Type.String({ description: "Written feedback or critique received" }),
			rubricDimensions: Type.Optional(Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 }))),
			date: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const now = params.date || new Date().toISOString();
			const state = loadLearnerState(cwd, params.topic.trim());
			const skill = state.skills[params.skill.trim()];

			const event = createLearningEvent({
				learnerId: "local-learner",
				sessionId: sessionId(ctx),
				attemptId: crypto.randomUUID(),
				topicId: params.topic.trim(),
				skillIds: [params.skill.trim()],
				knowledgeObjectIds: [params.skill.trim()],
				taskId: `external:${params.sourceType}:${crypto.randomUUID().slice(0, 8)}`,
				mode: "assessment",
				phase: "external",
				taskType: "authentic-performance",
				prompt: `External evaluation by ${params.evaluator} (${params.sourceType})`,
				response: params.feedback,
				score: params.score,
				correct: params.score >= 0.7,
				startedAt: now,
				submittedAt: now,
				latencyMs: 0,
				priorEncounterCount: 0,
				hintsRequested: 0,
				maximumHintDepth: 0,
				assistanceState: "none",
				feedbackIds: [`external-${params.evaluator}`],
				representation: "mixed",
				novelty: "authentic",
				sourceContext: "external-human",
				contentVersion: "external-v1",
			}, cwd);

			const ingestion = ingestLearningEvent(cwd, event);

			let discrepancyNote = "";
			if (skill && skill.memoryAccessibility.mean >= 0.75 && params.score < 0.6) {
				discrepancyNote = `\nWARNING: Model discrepancy detected! Internal memory estimate was ${(skill.memoryAccessibility.mean * 100).toFixed(0)}%, but authentic external score is ${(params.score * 100).toFixed(0)}%. Model uncertainty raised; investigate item leakage or context mismatch.`;
				// Reload after ingestion; saving the pre-event snapshot would erase the authentic result and its gaps.
				const updated = loadLearnerState(cwd, params.topic.trim());
				const current = updated.skills[params.skill.trim()];
				if (current) {
					current.memoryAccessibility.uncertainty = Math.min(1, current.memoryAccessibility.uncertainty + 0.2);
					saveLearnerState(cwd, updated);
				}
			}

			const lines = [
				`External evidence ingested: ${params.topic}/${params.skill}`,
				`Evaluator: ${params.evaluator} (${params.sourceType})`,
				`Score: ${(params.score * 100).toFixed(1)}% (Threshold: 70%)`,
				`Feedback: ${params.feedback}`,
				discrepancyNote,
			].filter(Boolean);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { ingestion, discrepancy: Boolean(discrepancyNote) },
			};
		},
	});

	pi.registerCommand("mastery", {
		description: "Show multidimensional learner-state summary for a topic",
		handler: async (args, ctx: any) => {
			const topic = args.trim();
			if (!topic) return ctx.ui.notify("Usage: /mastery <topic>", "warning");
			const state = loadLearnerState(ctx.cwd || process.cwd(), topic);
			const lines = Object.entries(state.skills).map(([id, skill]) => `${skill.lifecycleState === "durably-mastered" ? "✓" : "○"} ${id}: ${skill.lifecycleState}; memory ${(skill.memoryAccessibility.mean * 100).toFixed(0)}%, transfer ${(skill.transfer.mean * 100).toFixed(0)}%`);
			ctx.ui.notify(lines.length ? lines.join("\n") : `No evidence for ${topic}.`, "info");
		},
	});
}
