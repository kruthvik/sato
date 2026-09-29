import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { computeNextStability, mapRaschToFsrsDifficulty } from "./fsrs.ts";
import { getSessionMemoryController } from "./memory-controller.ts";
import { loadPolicy, type LearningMode } from "./policy.ts";

export type EvidencePhase = "diagnostic" | "instruction" | "practice" | "assessment" | "review" | "external";
export type TaskType =
	| "exposure" | "recognition" | "cued-recall" | "free-recall" | "self-explanation"
	| "discrimination" | "prediction" | "procedure" | "representation-conversion"
	| "analogy" | "error-diagnosis" | "near-transfer" | "far-transfer" | "simulation"
	| "authentic-performance";
export type RepresentationType = "verbal" | "symbolic" | "graphical" | "spatial" | "procedural" | "mixed";
export type NoveltyType = "repeated" | "isomorphic" | "near-transfer" | "far-transfer" | "authentic";
export type AssistanceState = "none" | "minimal" | "guided" | "worked-solution" | "AI-performed";
export type ErrorCategory =
	| "memory-failure" | "missing-prerequisite" | "conceptual-model-error" | "misconception"
	| "discrimination-error" | "method-selection-error" | "representation-error" | "procedure-error"
	| "execution-slip" | "omitted-constraint" | "prompt-misread" | "time-pressure-failure"
	| "communication-failure" | "source-content-error" | "grading-uncertainty";
export type LearnerDimension =
	| "memoryAccessibility" | "structuralUnderstanding" | "discrimination" | "application"
	| "transfer" | "representationFlexibility" | "proceduralFluency" | "scaffoldIndependence" | "calibration";
export type MasteryLifecycleState =
	| "unseen" | "introduced" | "acquired" | "independently-produced" | "discrimination-demonstrated"
	| "transfer-demonstrated" | "delay-verified" | "provisionally-mastered" | "durably-mastered" | "lapsed";

export interface AssessmentContext {
	attemptId: string;
	topicId: string;
	skillIds: string[];
	knowledgeObjectIds: string[];
	mode: LearningMode;
	phase: EvidencePhase;
	taskType: TaskType;
	representation: RepresentationType;
	novelty: NoveltyType;
	itemFamilyId?: string;
	parallelFormId?: string;
	targetDeadline?: string | null;
	retentionHorizon?: string | null;
}

export interface LearningEventV1 {
	version: 1;
	eventId: string;
	idempotencyKey: string;
	learnerId: string;
	sessionId: string;
	attemptId: string;
	parentAttemptId?: string;
	occurredAt: string;
	topicId: string;
	knowledgeObjectIds: string[];
	skillIds: string[];
	taskId: string;
	itemFamilyId?: string;
	parallelFormId?: string;
	mode: LearningMode;
	phase: EvidencePhase;
	taskType: TaskType;
	prompt: string;
	response: unknown;
	rubricId?: string;
	rubricScores?: Record<string, number>;
	score: number;
	correct?: boolean;
	startedAt: string;
	submittedAt: string;
	latencyMs: number;
	priorExposureAt?: string;
	priorIntervalMs?: number;
	priorEncounterCount: number;
	confidenceBefore?: number;
	predictedScore?: number;
	predictedLatencyMs?: number;
	hintsRequested: number;
	maximumHintDepth: number;
	assistanceState: AssistanceState;
	feedbackIds: string[];
	feedbackShownAt?: string;
	representation: RepresentationType;
	novelty: NoveltyType;
	sourceContext: "generated" | "authoritative-bank" | "learner-supplied" | "external-human" | "real-world";
	errorCategory?: ErrorCategory;
	misconceptionIds?: string[];
	deviceContext?: string;
	policyVersion: string;
	contentVersion: string;
	targetDeadline?: string | null;
	retentionHorizon?: string | null;
}

export interface DimensionEstimate {
	mean: number;
	uncertainty: number;
	evidenceCount: number;
	alpha?: number;
	beta?: number;
	lastEvidenceAt?: string;
	lastIndependentEvidenceAt?: string;
	lastDelayedEvidenceAt?: string;
}

export interface MasteryEvidenceSummary {
	unaidedRetrievalEventId?: string;
	explanationEventId?: string;
	discriminationEventId?: string;
	novelApplicationEventId?: string;
	independentAssessmentEventId?: string;
	delayedRetrievalEventId?: string;
	delayedTransferEventId?: string;
	authenticPerformanceEventId?: string;
	minimumDelaySatisfied: boolean;
	unresolvedCriticalErrors: string[];
}

export interface GapCase {
	gapId: string;
	skillIds: string[];
	originatingEventId: string;
	originatingAttemptId: string;
	originatingTaskId: string;
	openedAt: string;
	category: ErrorCategory;
	severity: "low" | "medium" | "high" | "critical";
	status: "open" | "repaired-unverified" | "scheduled-for-verification" | "cleared" | "unresolved";
	repairInterventionIds: string[];
	verificationEventId?: string;
	recurrenceCount: number;
}

export interface SkillLearnerState {
	skillId: string;
	memoryAccessibility: DimensionEstimate;
	structuralUnderstanding: DimensionEstimate;
	discrimination: DimensionEstimate;
	application: DimensionEstimate;
	transfer: DimensionEstimate;
	representationFlexibility: DimensionEstimate;
	proceduralFluency: DimensionEstimate;
	scaffoldIndependence: DimensionEstimate;
	calibration: DimensionEstimate;
	lifecycleState: MasteryLifecycleState;
	activeMisconceptionIds: string[];
	unresolvedErrorIds: string[];
	evidenceSummary: MasteryEvidenceSummary;
	gapCases: GapCase[];
	processedEventIds: string[];
	legacyModelScore: number;
	lastUpdated: string;
	memoryStabilityDays?: number;
	operationalAbility?: number;
	assistanceState?: number;
	errorDistribution?: Record<string, number>;
}

export interface TopicLearnerState {
	version: 2;
	topic: string;
	skills: Record<string, SkillLearnerState>;
	lastUpdated: string;
}

const DIMENSIONS: LearnerDimension[] = [
	"memoryAccessibility", "structuralUnderstanding", "discrimination", "application", "transfer",
	"representationFlexibility", "proceduralFluency", "scaffoldIndependence", "calibration",
];

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general"; }
function estimate(mean = 0.1): DimensionEstimate {
	const clamped = clamp(mean);
	return {
		mean: clamped,
		uncertainty: 1,
		evidenceCount: 0,
		alpha: Math.max(0.1, clamped * 2),
		beta: Math.max(0.1, (1 - clamped) * 2),
	};
}

function newSkill(skillId: string): SkillLearnerState {
	const now = new Date().toISOString();
	return {
		skillId,
		memoryAccessibility: estimate(), structuralUnderstanding: estimate(), discrimination: estimate(),
		application: estimate(), transfer: estimate(), representationFlexibility: estimate(),
		proceduralFluency: estimate(), scaffoldIndependence: estimate(), calibration: estimate(0.5),
		lifecycleState: "unseen", activeMisconceptionIds: [], unresolvedErrorIds: [],
		evidenceSummary: { minimumDelaySatisfied: false, unresolvedCriticalErrors: [] }, gapCases: [],
		processedEventIds: [], legacyModelScore: 0.1, lastUpdated: now,
		memoryStabilityDays: 1.0,
		operationalAbility: 0.0,
		assistanceState: 0.0,
		errorDistribution: {},
	};
}

function hydrateEstimate(value: unknown, fallbackMean = 0.1): DimensionEstimate {
	const fallback = estimate(fallbackMean);
	if (!value || typeof value !== "object") return fallback;
	const stored = value as Partial<DimensionEstimate>;
	return {
		...fallback,
		...stored,
		mean: Number.isFinite(stored.mean) ? clamp(stored.mean!) : fallback.mean,
		uncertainty: Number.isFinite(stored.uncertainty) ? clamp(stored.uncertainty!) : fallback.uncertainty,
		evidenceCount: Number.isFinite(stored.evidenceCount) ? Math.max(0, stored.evidenceCount!) : fallback.evidenceCount,
	};
}

/** Hydrate optional Phase 1–6 fields so older version-2 files remain safe to update. */
function hydrateSkillState(skillId: string, value: unknown): SkillLearnerState {
	const fallback = newSkill(skillId);
	if (!value || typeof value !== "object") return fallback;
	const stored = value as Partial<SkillLearnerState>;
	return {
		...fallback,
		...stored,
		skillId,
		memoryAccessibility: hydrateEstimate(stored.memoryAccessibility),
		structuralUnderstanding: hydrateEstimate(stored.structuralUnderstanding),
		discrimination: hydrateEstimate(stored.discrimination),
		application: hydrateEstimate(stored.application),
		transfer: hydrateEstimate(stored.transfer),
		representationFlexibility: hydrateEstimate(stored.representationFlexibility),
		proceduralFluency: hydrateEstimate(stored.proceduralFluency),
		scaffoldIndependence: hydrateEstimate(stored.scaffoldIndependence),
		calibration: hydrateEstimate(stored.calibration, 0.5),
		activeMisconceptionIds: Array.isArray(stored.activeMisconceptionIds) ? stored.activeMisconceptionIds : [],
		unresolvedErrorIds: Array.isArray(stored.unresolvedErrorIds) ? stored.unresolvedErrorIds : [],
		gapCases: Array.isArray(stored.gapCases) ? stored.gapCases : [],
		processedEventIds: Array.isArray(stored.processedEventIds) ? stored.processedEventIds : [],
		evidenceSummary: {
			...fallback.evidenceSummary,
			...(stored.evidenceSummary || {}),
			unresolvedCriticalErrors: Array.isArray(stored.evidenceSummary?.unresolvedCriticalErrors)
				? stored.evidenceSummary.unresolvedCriticalErrors
				: [],
		},
		errorDistribution: stored.errorDistribution && typeof stored.errorDistribution === "object"
			? stored.errorDistribution
			: {},
	};
}

function statePath(cwd: string, topic: string): string {
	return path.join(cwd, "_learning", "mastery", `${slug(topic)}.json`);
}

export function loadLearnerState(cwd: string, topic: string): TopicLearnerState {
	const file = statePath(cwd, topic);
	if (!fs.existsSync(file)) return { version: 2, topic, skills: {}, lastUpdated: new Date().toISOString() };
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`Learner state is unreadable; refusing to replace ${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Learner state is invalid; refusing to replace ${file}`);
	}
	if (parsed.version === 2) {
		const skills: Record<string, SkillLearnerState> = {};
		const storedSkills = parsed.skills && typeof parsed.skills === "object" && !Array.isArray(parsed.skills)
			? parsed.skills as Record<string, unknown>
			: {};
		for (const [skillId, stored] of Object.entries(storedSkills)) skills[skillId] = hydrateSkillState(skillId, stored);
		return {
			version: 2,
			topic: typeof parsed.topic === "string" && parsed.topic ? parsed.topic : topic,
			skills,
			lastUpdated: typeof parsed.lastUpdated === "string" ? parsed.lastUpdated : new Date().toISOString(),
		};
	}
	const migrated: TopicLearnerState = {
		version: 2,
		topic: typeof parsed.topic === "string" && parsed.topic ? parsed.topic : topic,
		skills: {},
		lastUpdated: typeof parsed.lastUpdated === "string" ? parsed.lastUpdated : new Date().toISOString(),
	};
	const legacySkills = parsed.skills && typeof parsed.skills === "object" && !Array.isArray(parsed.skills)
		? parsed.skills as Record<string, { pL?: unknown; history?: unknown[]; gapStatus?: unknown }>
		: {};
	for (const [skillId, legacy] of Object.entries(legacySkills)) {
		const state = newSkill(skillId);
		const prior = clamp(Number(legacy.pL) || 0.1);
		state.memoryAccessibility.mean = prior;
		state.memoryAccessibility.evidenceCount = Array.isArray(legacy.history) ? legacy.history.length : 0;
		state.memoryAccessibility.uncertainty = 1 / Math.sqrt(1 + state.memoryAccessibility.evidenceCount);
		state.legacyModelScore = prior;
		state.lifecycleState = state.memoryAccessibility.evidenceCount ? (prior >= 0.55 ? "acquired" : "introduced") : "unseen";
		if (legacy.gapStatus && legacy.gapStatus !== "cleared") state.unresolvedErrorIds.push(`legacy-gap-${skillId}`);
		migrated.skills[skillId] = state;
	}
	return migrated;
}

export function saveLearnerState(cwd: string, state: TopicLearnerState): void {
	const file = statePath(cwd, state.topic);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	state.lastUpdated = new Date().toISOString();
	const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf-8");
		fs.renameSync(temporary, file);
	} finally {
		if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
	}
}

function eventsPath(cwd: string): string { return path.join(cwd, "_learning", "events", "learning-events-v1.jsonl"); }

export function readLearningEvents(cwd: string, topicId?: string): LearningEventV1[] {
	const file = eventsPath(cwd);
	if (!fs.existsSync(file)) return [];
	return fs.readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try {
			const event = JSON.parse(line) as LearningEventV1;
			return !topicId || event.topicId === topicId ? [event] : [];
		} catch { return []; }
	});
}

export function validateLearningEvent(event: LearningEventV1): string[] {
	const errors: string[] = [];
	if (event.version !== 1) errors.push("version must be 1");
	for (const field of ["eventId", "idempotencyKey", "learnerId", "sessionId", "attemptId", "topicId", "taskId", "prompt", "policyVersion", "contentVersion"] as const) {
		if (!String(event[field] || "").trim()) errors.push(`${field} is required`);
	}
	if (!Array.isArray(event.skillIds) || event.skillIds.length === 0) errors.push("skillIds requires at least one skill");
	if (!Array.isArray(event.knowledgeObjectIds) || event.knowledgeObjectIds.length === 0) errors.push("knowledgeObjectIds requires at least one object");
	if (!Number.isFinite(event.score) || event.score < 0 || event.score > 1) errors.push("score must be from 0 to 1");
	if (!Number.isFinite(event.latencyMs) || event.latencyMs < 0) errors.push("latencyMs must be non-negative");
	if (!Number.isInteger(event.hintsRequested) || event.hintsRequested < 0) errors.push("hintsRequested must be a non-negative integer");
	if (!Number.isInteger(event.maximumHintDepth) || event.maximumHintDepth < 0 || event.maximumHintDepth > 6) errors.push("maximumHintDepth must be from 0 to 6");
	if (Number.isNaN(Date.parse(event.occurredAt)) || Number.isNaN(Date.parse(event.startedAt)) || Number.isNaN(Date.parse(event.submittedAt))) errors.push("event timestamps must be ISO dates");
	if (event.confidenceBefore !== undefined && (event.confidenceBefore < 0 || event.confidenceBefore > 1)) errors.push("confidenceBefore must be from 0 to 1");
	try { JSON.stringify(event.response); } catch { errors.push("response must be JSON serializable"); }
	return errors;
}

const DIMENSION_MAP: Record<TaskType, Array<[LearnerDimension, number]>> = {
	exposure: [["memoryAccessibility", 0.15]], recognition: [["memoryAccessibility", 0.5]],
	"cued-recall": [["memoryAccessibility", 0.75], ["proceduralFluency", 0.15]],
	"free-recall": [["memoryAccessibility", 1], ["structuralUnderstanding", 0.25]],
	"self-explanation": [["structuralUnderstanding", 1], ["memoryAccessibility", 0.3]],
	discrimination: [["discrimination", 1], ["application", 0.25]], prediction: [["structuralUnderstanding", 0.7], ["transfer", 0.4]],
	procedure: [["application", 0.8], ["proceduralFluency", 0.8]],
	"representation-conversion": [["representationFlexibility", 1], ["structuralUnderstanding", 0.5]],
	analogy: [["structuralUnderstanding", 0.6], ["transfer", 0.65]],
	"error-diagnosis": [["structuralUnderstanding", 0.7], ["discrimination", 0.7]],
	"near-transfer": [["application", 0.8], ["transfer", 0.8]], "far-transfer": [["transfer", 1], ["application", 0.6]],
	simulation: [["application", 0.9], ["proceduralFluency", 0.6], ["transfer", 0.5]],
	"authentic-performance": [["application", 1], ["transfer", 1], ["proceduralFluency", 0.6]],
};

/**
 * Conjugate Beta updating with temporal memory discount (gamma=0.98) and sample ceiling (N_max=20).
 * Reference: research/learning.md:504–534; outputs/adaptive-learning-next-action.md Section 2.2.
 * Prevents asymptotic belief freezing (sample size collapse to O(1/N)) while preserving empirical evidence weighting.
 */
function updateEstimate(target: DimensionEstimate, observed: number, weight: number, event: LearningEventV1, discount = 0.98, maxN = 20): void {
	const currentMean = clamp(target.mean ?? 0.1);
	const currentAlpha = target.alpha ?? (currentMean * 2);
	const currentBeta = target.beta ?? ((1 - currentMean) * 2);

	// Apply memory discount factor to preserve plasticity and prevent belief freezing
	const discountedAlpha = currentAlpha * discount;
	const discountedBeta = currentBeta * discount;

	const effectiveWeight = Math.max(0.05, weight);
	let nextAlpha = discountedAlpha + effectiveWeight * observed;
	let nextBeta = discountedBeta + effectiveWeight * (1 - observed);

	// Enforce effective sample size ceiling
	const totalN = nextAlpha + nextBeta;
	if (totalN > maxN) {
		const scale = maxN / totalN;
		nextAlpha *= scale;
		nextBeta *= scale;
	}

	target.alpha = nextAlpha;
	target.beta = nextBeta;
	target.mean = clamp(nextAlpha / (nextAlpha + nextBeta));
	target.evidenceCount++;
	target.uncertainty = Math.max(0.08, 1 / Math.sqrt(1 + nextAlpha + nextBeta));
	target.lastEvidenceAt = event.occurredAt;
	if (event.assistanceState === "none") target.lastIndependentEvidenceAt = event.occurredAt;
	if ((event.priorIntervalMs || 0) >= 600000) target.lastDelayedEvidenceAt = event.occurredAt;
}

/**
 * Independence requirement for mastery and verification.
 * Reference: research/learning.md:221–234; Soderstrom & Bjork (2015) DOI: 10.1177/1745691615599990.
 * Assisted, hinted, or copied success cannot satisfy durable mastery or clear error gaps.
 */
function qualifyingSuccess(event: LearningEventV1): boolean {
	return event.score >= 0.7 && event.assistanceState === "none" && event.maximumHintDepth === 0;
}

function refreshEvidenceSummary(skill: SkillLearnerState, event: LearningEventV1, minimumDelayMs: number, minimumDurableMs: number): void {
	if (!qualifyingSuccess(event)) return;
	const summary = skill.evidenceSummary;
	const delayed = (event.priorIntervalMs || 0) >= minimumDelayMs;
	if (["cued-recall", "free-recall"].includes(event.taskType)) {
		summary.unaidedRetrievalEventId = event.eventId;
		if (delayed) summary.delayedRetrievalEventId = event.eventId;
	}
	if (event.taskType === "self-explanation") summary.explanationEventId = event.eventId;
	if (event.taskType === "discrimination") summary.discriminationEventId = event.eventId;
	if (["near-transfer", "far-transfer", "simulation", "authentic-performance"].includes(event.taskType) && event.novelty !== "repeated") summary.novelApplicationEventId = event.eventId;
	if (["near-transfer", "far-transfer", "authentic-performance"].includes(event.taskType) && (event.priorIntervalMs || 0) >= minimumDurableMs && ["near-transfer", "far-transfer", "authentic"].includes(event.novelty)) summary.delayedTransferEventId = event.eventId;
	if (event.phase === "assessment" && event.mode === "assessment") summary.independentAssessmentEventId = event.eventId;
	if (event.taskType === "authentic-performance" && ["external-human", "real-world"].includes(event.sourceContext)) summary.authenticPerformanceEventId = event.eventId;
	summary.minimumDelaySatisfied = Boolean(summary.delayedRetrievalEventId || summary.delayedTransferEventId);
}

function openOrEscalateGap(skill: SkillLearnerState, event: LearningEventV1): void {
	const category = event.errorCategory || (event.taskType === "recognition" || event.taskType.includes("recall") ? "memory-failure" : "conceptual-model-error");
	const recurring = skill.gapCases.filter((gap) => gap.category === category).length;
	const severity: GapCase["severity"] = recurring >= 3 ? "critical" : recurring === 2 ? "high" : recurring === 1 ? "medium" : "low";
	const gap: GapCase = {
		gapId: crypto.randomUUID(), skillIds: event.skillIds, originatingEventId: event.eventId,
		originatingAttemptId: event.attemptId, originatingTaskId: event.taskId, openedAt: event.occurredAt,
		category, severity, status: event.assistanceState === "worked-solution" || event.assistanceState === "AI-performed" ? "repaired-unverified" : "open",
		repairInterventionIds: [], recurrenceCount: recurring,
	};
	skill.gapCases.push(gap);
	skill.unresolvedErrorIds.push(gap.gapId);
	if (event.misconceptionIds) skill.activeMisconceptionIds = [...new Set([...skill.activeMisconceptionIds, ...event.misconceptionIds])];
}

/**
 * GapEscrow non-remediation invariant.
 * Reference: research/learning.md:272–310; research/cramming.md:320–360.
 * A remediation attempt on the same item cannot clear its own gap.
 * Requires an independent parallel form after intervening items or time separation.
 */
function verifyGaps(skill: SkillLearnerState, event: LearningEventV1, topicEvents: LearningEventV1[], cwd: string): void {
	if (!qualifyingSuccess(event)) return;
	const policy = loadPolicy(cwd);
	for (const gap of skill.gapCases) {
		if (gap.status === "cleared") continue;
		const originIndex = topicEvents.findIndex((candidate) => candidate.eventId === gap.originatingEventId);
		const currentIndex = topicEvents.findIndex((candidate) => candidate.eventId === event.eventId);
		const intervening = originIndex >= 0 && currentIndex >= 0 ? currentIndex - originIndex - 1 : 0;
		const elapsed = Date.parse(event.occurredAt) - Date.parse(gap.openedAt);
		const independentAttempt = event.attemptId !== gap.originatingAttemptId && event.parentAttemptId !== gap.originatingAttemptId;
		const parallelTask = event.taskId !== gap.originatingTaskId || Boolean(event.parallelFormId);
		const enoughSeparation = intervening >= policy.gapEscrow.minimumInterveningEvents || elapsed >= policy.gapEscrow.minimumVerificationDelayMs;
		const validNovelty = policy.gapEscrow.verificationNovelty.includes(event.novelty) ||
			(["near-transfer", "far-transfer", "authentic"].includes(event.novelty) && policy.gapEscrow.verificationNovelty.includes("transfer"));
		if (independentAttempt && parallelTask && enoughSeparation && validNovelty) {
			gap.status = "cleared";
			gap.verificationEventId = event.eventId;
			skill.unresolvedErrorIds = skill.unresolvedErrorIds.filter((id) => id !== gap.gapId);
		}
	}
}

/**
 * Multidimensional Vector Mastery State Machine.
 * Reference: research/learning.md:46–74; implementations.md:16–37; outputs/adaptive-learning-next-action.md Section 2.
 * Requires unaided retrieval, discrimination, novel application, and delayed verification.
 * Eliminates scalar mastery gating.
 */
function refreshLifecycle(skill: SkillLearnerState, latest: LearningEventV1): void {
	const evidence = skill.evidenceSummary;
	const unresolvedCritical = skill.gapCases.filter((gap) => gap.status !== "cleared" && ["high", "critical"].includes(gap.severity)).map((gap) => gap.gapId);
	evidence.unresolvedCriticalErrors = unresolvedCritical;
	const noOpenGaps = skill.gapCases.every((gap) => gap.status === "cleared");
	let lifecycle: MasteryLifecycleState = "introduced";
	if (skill.memoryAccessibility.mean >= 0.55) lifecycle = "acquired";
	if (evidence.unaidedRetrievalEventId) lifecycle = "independently-produced";
	if (evidence.discriminationEventId) lifecycle = "discrimination-demonstrated";
	if (evidence.novelApplicationEventId) lifecycle = "transfer-demonstrated";
	if (evidence.delayedRetrievalEventId) lifecycle = "delay-verified";
	const provisional = Boolean(evidence.unaidedRetrievalEventId && evidence.explanationEventId && evidence.discriminationEventId && evidence.novelApplicationEventId && evidence.delayedRetrievalEventId && noOpenGaps);
	if (provisional) lifecycle = "provisionally-mastered";
	if (provisional && (evidence.delayedTransferEventId || evidence.authenticPerformanceEventId)) lifecycle = "durably-mastered";
	if (latest.score < 0.7 && (latest.priorIntervalMs || 0) >= 600000 && ["provisionally-mastered", "durably-mastered"].includes(skill.lifecycleState)) lifecycle = "lapsed";
	skill.lifecycleState = lifecycle;
}

/**
 * Dimension-specific routing, assistance isolation, and memory stability updates.
 * Reference: research/learning.md:504–534; outputs/adaptive-learning-next-action.md Section 2.2, 4.1.
 * Updates assistanceState A from support level, operational ability from Rasch/Elo,
 * and memory stability days via FSRS piecewise stability equations.
 */
function updateSkill(skill: SkillLearnerState, event: LearningEventV1, topicEvents: LearningEventV1[], cwd: string): void {
	if (skill.processedEventIds.includes(event.eventId)) return;
	const assistanceWeight: Record<AssistanceState, number> = { none: 1, minimal: 0.75, guided: 0.45, "worked-solution": 0.15, "AI-performed": 0 };
	const delayWeight = (event.priorIntervalMs || 0) >= loadPolicy(cwd).mastery.minimumDelayedEvidenceMs ? 1.2 : 1;
	const noveltyWeight: Record<NoveltyType, number> = { repeated: 0.55, isomorphic: 0.75, "near-transfer": 1, "far-transfer": 1.15, authentic: 1.25 };
	for (const [dimension, baseWeight] of DIMENSION_MAP[event.taskType]) updateEstimate(skill[dimension], event.score, baseWeight * assistanceWeight[event.assistanceState] * delayWeight * noveltyWeight[event.novelty], event);
	updateEstimate(skill.scaffoldIndependence, event.score * assistanceWeight[event.assistanceState], 0.8, event);
	if (event.predictedScore !== undefined || event.confidenceBefore !== undefined) {
		const prediction = event.predictedScore ?? event.confidenceBefore!;
		updateEstimate(skill.calibration, 1 - Math.abs(prediction - event.score), 0.8, event);
	}
	if (event.score < loadPolicy(cwd).successScore) openOrEscalateGap(skill, event);
	else verifyGaps(skill, event, topicEvents, cwd);

	const assistanceValues = { none: 0, minimal: 0.25, guided: 0.55, "worked-solution": 0.85, "AI-performed": 1.0 } satisfies Record<AssistanceState, number>;
	skill.assistanceState = 0.7 * (skill.assistanceState ?? 0) + 0.3 * assistanceValues[event.assistanceState];

	if (event.score < loadPolicy(cwd).successScore) {
		const cat = event.errorCategory || "memory-failure";
		skill.errorDistribution = skill.errorDistribution || {};
		skill.errorDistribution[cat] = (skill.errorDistribution[cat] || 0) + 1;
	}

	if (["cued-recall", "free-recall", "procedure", "near-transfer", "far-transfer", "simulation"].includes(event.taskType)) {
		const currentS = skill.memoryStabilityDays ?? 1.0;
		const currentAbility = skill.operationalAbility ?? 0.0;
		const diff = mapRaschToFsrsDifficulty(currentAbility);
		const outcome: 0 | 1 = event.score >= loadPolicy(cwd).successScore ? 1 : 0;
		const recallProb = clamp(skill.memoryAccessibility.mean);
		skill.memoryStabilityDays = computeNextStability(currentS, diff, recallProb, outcome);
	}

	if (event.assistanceState === "none") {
		const currentTheta = skill.operationalAbility ?? 0.0;
		const kFactor = 0.2;
		const pPred = 1 / (1 + Math.exp(-currentTheta));
		skill.operationalAbility = currentTheta + kFactor * (event.score - pPred);
	}

	const masteryPolicy = loadPolicy(cwd).mastery;
	refreshEvidenceSummary(skill, event, masteryPolicy.minimumDelayedEvidenceMs, masteryPolicy.minimumDurableEvidenceMs);
	refreshLifecycle(skill, event);
	skill.legacyModelScore = DIMENSIONS.filter((dimension) => dimension !== "calibration").reduce((sum, dimension) => sum + skill[dimension].mean, 0) / (DIMENSIONS.length - 1);
	skill.processedEventIds.push(event.eventId);
	if (skill.processedEventIds.length > 500) skill.processedEventIds.splice(0, skill.processedEventIds.length - 500);
	skill.lastUpdated = event.occurredAt;
}

export interface IngestResult {
	accepted: boolean;
	duplicate: boolean;
	errors: string[];
	event: LearningEventV1;
	states: Record<string, SkillLearnerState>;
}

export function ingestLearningEvent(cwd: string, event: LearningEventV1): IngestResult {
	const errors = validateLearningEvent(event);
	if (errors.length) return { accepted: false, duplicate: false, errors, event, states: {} };
	const priorEvents = readLearningEvents(cwd, event.topicId);
	const duplicate = priorEvents.some((candidate) => candidate.eventId === event.eventId || candidate.idempotencyKey === event.idempotencyKey);
	if (duplicate) return { accepted: true, duplicate: true, errors: [], event, states: {} };
	const file = eventsPath(cwd);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf-8");
	const state = loadLearnerState(cwd, event.topicId);
	const states: Record<string, SkillLearnerState> = {};
	const topicEvents = [...priorEvents, event];
	for (const skillId of event.skillIds) {
		const skill = state.skills[skillId] || newSkill(skillId);
		updateSkill(skill, event, topicEvents, cwd);
		state.skills[skillId] = skill;
		states[skillId] = skill;
	}
	saveLearnerState(cwd, state);

	// Synchronize session-scoped memory controller for intra-session lag enforcement
	const memCtrl = getSessionMemoryController(event.sessionId);
	memCtrl.addActiveMinutes(event.latencyMs / 60000);
	const attemptTime = new Date(event.submittedAt);
	for (const skillId of event.skillIds) {
		memCtrl.recordAttempt(skillId, event.taskId, event.score, Number.isNaN(attemptTime.getTime()) ? new Date() : attemptTime);
	}

	return { accepted: true, duplicate: false, errors: [], event, states };
}

export function modeReadiness(state: SkillLearnerState, mode: LearningMode): { ready: boolean; label: string; missing: string[] } {
	const e = state.evidenceSummary;
	const noOpenGaps = state.gapCases.every((gap) => gap.status === "cleared");
	if (mode === "exam-drill") {
		const missing = [!e.unaidedRetrievalEventId && "unaided test item", !e.explanationEventId && "open explanation", !e.discriminationEventId && "discrimination", !e.novelApplicationEventId && "variant problem transfer", !e.independentAssessmentEventId && "representative independent assessment", !noOpenGaps && "verify all open gaps"].filter(Boolean) as string[];
		return { ready: missing.length === 0, label: "criterion-ready", missing };
	}
	if (mode === "cram") {
		const missing = [!e.unaidedRetrievalEventId && "unaided retrieval", !e.explanationEventId && "causal explanation", !e.discriminationEventId && "nearest-trap discrimination", !e.novelApplicationEventId && "changed target-like case", !e.independentAssessmentEventId && "representative independent assessment", !noOpenGaps && "verify all open gaps"].filter(Boolean) as string[];
		return { ready: missing.length === 0, label: "deadline-ready", missing };
	}
	if (mode === "fast-learn") {
		const missing = [!e.unaidedRetrievalEventId && "unaided production", !e.explanationEventId && "coherent explanation", !e.discriminationEventId && "nearest-trap discrimination", !e.novelApplicationEventId && "changed-case application", !noOpenGaps && "verify all open gaps"].filter(Boolean) as string[];
		return { ready: missing.length === 0, label: "functionally-ready", missing };
	}
	if (mode === "project") {
		const missing = [!e.explanationEventId && "explain design tradeoffs", !e.novelApplicationEventId && "independent artifact milestone", !noOpenGaps && "verify all open gaps"].filter(Boolean) as string[];
		return { ready: missing.length === 0, label: "milestone-ready", missing };
	}
	const missing = [!e.unaidedRetrievalEventId && "unaided retrieval", !e.explanationEventId && "causal explanation", !e.discriminationEventId && "discrimination", !e.novelApplicationEventId && "unfamiliar application", !e.delayedRetrievalEventId && "delayed retrieval", !noOpenGaps && "verify all open gaps"].filter(Boolean) as string[];
	return { ready: missing.length === 0, label: state.lifecycleState, missing };
}

export function createLearningEvent(input: Omit<LearningEventV1, "version" | "eventId" | "idempotencyKey" | "occurredAt" | "policyVersion"> & { eventId?: string; idempotencyKey?: string; occurredAt?: string }, cwd: string): LearningEventV1 {
	const eventId = input.eventId || crypto.randomUUID();
	return { ...input, version: 1, eventId, idempotencyKey: input.idempotencyKey || eventId, occurredAt: input.occurredAt || input.submittedAt, policyVersion: loadPolicy(cwd).version };
}

interface StoredContext extends AssessmentContext { token: string; createdAt: string; consumedAt?: string; }
function contextsPath(cwd: string): string { return path.join(cwd, "_learning", "contexts", "assessment-contexts.json"); }
function loadContexts(cwd: string): StoredContext[] {
	const file = contextsPath(cwd);
	if (!fs.existsSync(file)) return [];
	try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return []; }
}
export function createAssessmentContext(cwd: string, context: AssessmentContext): StoredContext {
	const contexts = loadContexts(cwd);
	const stored = { ...context, token: crypto.randomUUID(), createdAt: new Date().toISOString() };
	contexts.push(stored);
	fs.mkdirSync(path.dirname(contextsPath(cwd)), { recursive: true });
	fs.writeFileSync(contextsPath(cwd), JSON.stringify(contexts.slice(-500), null, 2), "utf-8");
	return stored;
}
export function consumeAssessmentContext(cwd: string, token: string): AssessmentContext | null {
	const contexts = loadContexts(cwd);
	const found = contexts.find((context) => context.token === token);
	if (!found || found.consumedAt) return null;
	found.consumedAt = new Date().toISOString();
	fs.writeFileSync(contextsPath(cwd), JSON.stringify(contexts, null, 2), "utf-8");
	const { token: _token, createdAt: _createdAt, consumedAt: _consumedAt, ...context } = found;
	return context;
}
