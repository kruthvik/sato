import evidenceEngine from "../.pi/extensions/bkt-engine.ts";
import learningSessionExtension from "../.pi/extensions/learning-session.ts";
import domainGraphManager from "../.pi/extensions/dag-manager.ts";
import sessionInit from "../.pi/extensions/session-init.ts";
import { loadBrain } from "../.pi/core/brain.ts";
import { TEACHING_EXPERIENCE, readDeliveryContext } from "../.pi/core/teaching-context.ts";
import vaultGarage from "../.pi/extensions/vault-garage.ts";
import workspaceGuard from "../.pi/extensions/workspace-guard.ts";
import { findLearningOutliers, garageTopicDir, readGarageContext, saveApproachGarage } from "../.pi/core/vault-garage.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createLearningEvent, ingestLearningEvent, loadLearnerState, saveLearnerState, modeReadiness, type TopicLearnerState } from "../.pi/core/learning-events.ts";
import { validateDomainGraph, type DomainGraph } from "../.pi/core/domain-graph.ts";
import { applyFsrsReview, computeNextStability, mapRaschToFsrsDifficulty, fsrsRetrievability, halfLifeRetrievability } from "../.pi/core/fsrs.ts";
import { isActionEligible, ACTION_METAS, getActionEligibilityReport } from "../.pi/core/action-taxonomy.ts";
import { selectNextAction, estimateActionDuration, computeExplorationBudget, type ExamBlueprint } from "../.pi/core/action-selector.ts";
import { MemoryController, determineHorizonRegime, getSessionMemoryController, clearSessionMemoryController } from "../.pi/core/memory-controller.ts";
import {
	evaluatePolicySwitch,
	evaluatePolicyDoublyRobust,
	computeEffectiveSampleSize,
	logDecisionEvent,
	readDecisionEvents,
	type DecisionEventV1,
} from "../.pi/core/policy-evaluator.ts";
import {
	getPrerequisites,
	getDescendants,
	getDownstreamBlueprintWeight,
	getConfusableNeighbors,
	getTransferTargets,
	isPrerequisiteSatisfied,
} from "../.pi/core/domain-graph.ts";
import { loadPolicy, validatePolicy } from "../.pi/core/policy.ts";

let failures = 0;
function assert(value: unknown, message: string) {
	if (!value) { failures++; console.error(`FAIL: ${message}`); }
	else console.log(`PASS: ${message}`);
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "learn-engine-"));
fs.mkdirSync(path.join(cwd, ".pi", "config"), { recursive: true });
fs.copyFileSync(path.join(process.cwd(), ".pi", "config", "learning-policy.json"), path.join(cwd, ".pi", "config", "learning-policy.json"));
const policy = loadPolicy(cwd);
validatePolicy(policy);
assert(Object.values(policy.modes).every((mode) => Math.abs(mode.phases.reduce((sum, phase) => sum + phase.share, 0) - 1) < 1e-9), "all canonical phase allocations sum exactly to 100%");

const guardHandlers = new Map<string, any>();
workspaceGuard({ on: (name: string, handler: any) => guardHandlers.set(name, handler), registerCommand: () => {} } as any);
const guardToolCall = guardHandlers.get("tool_call");
const outsideRead = await guardToolCall({ toolName: "read", input: { path: path.resolve(cwd, "..", "outside.txt") } }, { cwd, hasUI: false });
const protectedRead = await guardToolCall({ toolName: "read", input: { path: ".pi/core/learning-events.ts" } }, { cwd, hasUI: false });
const workspaceWrite = await guardToolCall({ toolName: "write", input: { path: "content/topics/learner-note.md" } }, { cwd, hasUI: false });
assert(outsideRead?.block && protectedRead?.block && !workspaceWrite?.block, "workspace guard blocks external and engine-file access while allowing learner content writes");

// A normal session start must load learner-authored preferences before any read request.
const brainPath = path.join(cwd, "brain.md");
assert(loadBrain(cwd) === null, "missing brain.md has no preference context");
fs.writeFileSync(brainPath, "# My brain\n\n## How I learn\n<!-- template prompt -->\nI learn best from diagrams and a short example.\n---\n**For a new session:** Ask the tutor to read this.\n");
assert(loadBrain(cwd) === "I learn best from diagrams and a short example.", "brain loader removes template prompts and manual-read footer");
const startupHandlers = new Map<string, any>();
sessionInit({ on: (name: string, handler: any) => startupHandlers.set(name, handler), registerTool: () => {}, registerCommand: () => {} } as any);
await startupHandlers.get("session_start")({ reason: "startup" }, { cwd, ui: { setStatus: () => {} } });
const ordinaryTurn = await startupHandlers.get("before_agent_start")({ prompt: "Teach me fractions", systemPrompt: "Tutor rules" });
assert(ordinaryTurn.message.content.includes("diagrams and a short example"), "startup loads brain.md for an ordinary first turn without a manual prompt");
assert(ordinaryTurn.systemPrompt.includes(TEACHING_EXPERIENCE) && ordinaryTurn.systemPrompt.startsWith("Tutor rules"), "one calm teaching contract extends rather than replaces framework instructions");
assert(ordinaryTurn.systemPrompt.includes("Observed independent performance") && ordinaryTurn.systemPrompt.includes("answer-key protection"), "delivery preferences cannot override observed evidence or assessment integrity");
fs.writeFileSync(brainPath, "\n<!-- blank template -->\n");
await startupHandlers.get("session_start")({ reason: "new" }, { cwd, ui: { setStatus: () => {} } });
const emptyBrainTurn = await startupHandlers.get("before_agent_start")({ prompt: "Hello", systemPrompt: "Tutor rules" });
assert(emptyBrainTurn.systemPrompt.includes(TEACHING_EXPERIENCE) && !emptyBrainTurn.message, "empty brain.md keeps the shared teaching contract without inventing preferences");
assert(readDeliveryContext(cwd).preferences === null, "delivery context tolerates an empty brain.md");
fs.writeFileSync(brainPath, Buffer.from([0xff, 0xfe]));
assert(loadBrain(cwd) === null, "malformed UTF-8 brain.md is ignored safely");
fs.writeFileSync(brainPath, "<!-- unclosed comment");
assert(loadBrain(cwd) === null, "malformed Markdown comment is ignored safely");
fs.rmSync(brainPath);

let sequence = 0;
function event(overrides: Record<string, unknown> = {}) {
	sequence++;
	const submittedAt = new Date(Date.UTC(2026, 0, 1, 0, sequence * 5)).toISOString();
	return createLearningEvent({
		learnerId: "test", sessionId: "session", attemptId: `attempt-${sequence}`, topicId: "topic",
		knowledgeObjectIds: ["skill"], skillIds: ["skill"], taskId: `task-${sequence}`, mode: "teach", phase: "assessment",
		taskType: "free-recall", prompt: "prompt", response: "response", score: 1, correct: true,
		startedAt: submittedAt, submittedAt, latencyMs: 1000, priorEncounterCount: sequence - 1, hintsRequested: 0,
		maximumHintDepth: 0, assistanceState: "none", feedbackIds: [], representation: "verbal", novelty: "isomorphic",
		sourceContext: "generated", contentVersion: "test", ...overrides,
	} as any, cwd);
}

const first = event({ eventId: "stable-event", idempotencyKey: "stable-key", taskType: "free-recall" });
assert(ingestLearningEvent(cwd, first).accepted, "valid learning event is accepted");
assert(ingestLearningEvent(cwd, first).duplicate, "duplicate event is idempotent");
assert(loadLearnerState(cwd, "topic").skills.skill.processedEventIds.length === 1, "duplicate event does not update learner state twice");
ingestLearningEvent(cwd, event({ topicId: "durability-delay", taskType: "near-transfer", novelty: "near-transfer", priorIntervalMs: 600000 }));
assert(!loadLearnerState(cwd, "durability-delay").skills.skill.evidenceSummary.delayedTransferEventId, "ten-minute transfer cannot establish durable evidence");
ingestLearningEvent(cwd, event({ topicId: "durability-delay", taskType: "near-transfer", novelty: "near-transfer", priorIntervalMs: 86400000 }));
assert(Boolean(loadLearnerState(cwd, "durability-delay").skills.skill.evidenceSummary.delayedTransferEventId), "day-separated transfer qualifies as durable evidence");
const beforePerformance = loadLearnerState(cwd, "durability-delay").skills.skill;
assert(modeReadiness(beforePerformance, "cram").missing.includes("representative independent assessment"), "cram cannot claim deadline readiness without observed target performance");
ingestLearningEvent(cwd, event({ topicId: "durability-delay", taskType: "recognition", mode: "assessment", phase: "assessment" }));
const afterPerformance = loadLearnerState(cwd, "durability-delay").skills.skill;
assert(Boolean(afterPerformance.evidenceSummary.independentAssessmentEventId), "independent assessment records performance without converting recognition into application");

// Older version-2 files are hydrated instead of being treated as fully current.
const partialStatePath = path.join(cwd, "_learning", "mastery", "partial-state.json");
fs.writeFileSync(partialStatePath, JSON.stringify({
	version: 2,
	topic: "partial-state",
	lastUpdated: "2025-01-01T00:00:00.000Z",
	skills: { partial: { skillId: "partial", memoryAccessibility: { mean: 0.7, uncertainty: 0.2, evidenceCount: 3 } } },
}), "utf-8");
const hydrated = loadLearnerState(cwd, "partial-state").skills.partial;
assert(hydrated.memoryAccessibility.mean === 0.7 && hydrated.structuralUnderstanding.mean === 0.1, "version-2 learner state hydration preserves stored evidence and fills new dimensions");
assert(hydrated.memoryStabilityDays === 1 && hydrated.processedEventIds.length === 0, "version-2 learner state hydration fills new controller fields safely");

const corruptStatePath = path.join(cwd, "_learning", "mastery", "corrupt-state.json");
const corruptBytes = "{ definitely-not-json";
fs.writeFileSync(corruptStatePath, corruptBytes, "utf-8");
let corruptStateRejected = false;
try { loadLearnerState(cwd, "corrupt-state"); } catch { corruptStateRejected = true; }
assert(corruptStateRejected && fs.readFileSync(corruptStatePath, "utf-8") === corruptBytes, "corrupt learner state is rejected without destructive reset");

const recallState = loadLearnerState(cwd, "topic").skills.skill;
assert(recallState.memoryAccessibility.mean > recallState.discrimination.mean, "recall evidence raises memory without averaging away weak discrimination");
assert(!modeReadiness(recallState, "teach").ready, "recall alone cannot satisfy a mastery gate");

const failed = event({ attemptId: "failed-attempt", taskId: "origin-task", score: 0, correct: false, errorCategory: "misconception", novelty: "repeated" });
ingestLearningEvent(cwd, failed);
const selfRetry = event({ attemptId: "failed-attempt", parentAttemptId: "failed-attempt", taskId: "origin-task", score: 1, correct: true, novelty: "isomorphic" });
ingestLearningEvent(cwd, selfRetry);
let gap = loadLearnerState(cwd, "topic").skills.skill.gapCases.at(-1)!;
assert(gap.status !== "cleared", "a remediation attempt cannot clear its own gap");
const independent = event({ taskId: "parallel-task", parallelFormId: "parallel-b", score: 1, correct: true, novelty: "isomorphic" });
ingestLearningEvent(cwd, independent);
gap = loadLearnerState(cwd, "topic").skills.skill.gapCases.at(-1)!;
assert(gap.status === "cleared" && gap.verificationEventId === independent.eventId, "an independent parallel form after separation clears gap escrow");

const graph: DomainGraph = {
	version: 2, topic: "graph", lastUpdated: new Date().toISOString(),
	nodes: [{ id: "a", label: "A", type: "concept" }, { id: "b", label: "B", type: "concept" }],
	edges: [{ from: "a", to: "b", type: "confusable-with" }, { from: "b", to: "a", type: "confusable-with" }],
};
assert(validateDomainGraph(graph).length === 0, "typed graph permits cyclic confusion relations");
graph.edges = [{ from: "a", to: "b", type: "prerequisite" }, { from: "b", to: "a", type: "prerequisite" }];
assert(validateDomainGraph(graph).some((error) => error.includes("acyclic")), "typed graph rejects prerequisite cycles");

const memory = { difficulty: 5, stability: 0, reps: 0, lapses: 0 };
applyFsrsReview(memory, 3, new Date("2026-01-01T00:00:00.000Z"));
assert(memory.stability === 2.4 && memory.reps === 1, "shared FSRS initializes stability from the first observed retrieval");

// Verify unified FSRS and half-life retrievability mathematical definitions
assert(Math.abs(fsrsRetrievability(10, 10) - 0.90) < 1e-6, "fsrsRetrievability at t=S equals 0.90 by FSRS definition");
assert(Math.abs(halfLifeRetrievability(10, 10) - 0.50) < 1e-6, "halfLifeRetrievability at t=halfLife equals 0.50 by half-life definition");

// Verify Rasch difficulty mapping to positive FSRS scale
assert(mapRaschToFsrsDifficulty(-10) >= 1 && mapRaschToFsrsDifficulty(-10) < 1.01, "negative Rasch difficulty maps to strictly positive FSRS scale (> 1.0)");
assert(mapRaschToFsrsDifficulty(10) <= 10 && mapRaschToFsrsDifficulty(10) > 9.99, "positive Rasch difficulty maps to bounded FSRS scale (<= 10.0)");
assert(!Number.isNaN(mapRaschToFsrsDifficulty(-100)), "extreme negative Rasch difficulty does not yield NaN");

// Verify piecewise FSRS stability updates
const lapseStability = computeNextStability(10, 5, 0.2, 0);
assert(lapseStability <= 10, "retrieval lapse reduces or bounds stability below prior stability");
const successStabilityVal = computeNextStability(10, 5, 0.8, 1);
assert(successStabilityVal > 10, "successful retrieval expands stability above prior stability");

// Verify Beta updating plasticity (belief freezing prevention)
const plasticState = loadLearnerState(cwd, "topic").skills.skill;
assert(plasticState.memoryAccessibility.uncertainty >= 0.08, "uncertainty preserves lower bound");
assert(plasticState.memoryStabilityDays !== undefined && plasticState.memoryStabilityDays > 0, "state records memory stability in days");

// Test evidence-engine extensions: diagnose_error, cram_decision, simulate_assessment, ingest_external_evidence
const registeredTools = new Map<string, any>();
const registeredEvents = new Map<string, any>();
const mockApi: any = {
	registerTool: (t: any) => registeredTools.set(t.name, t),
	on: (name: string, handler: any) => registeredEvents.set(name, handler),
	registerCommand: () => {},
};
evidenceEngine(mockApi);

const reportTool = registeredTools.get("mastery_report");
const unmappedReport = await reportTool.execute("report-unmapped", { topic: "topic", mode: "fast-learn" }, undefined, undefined, { cwd });
assert(unmappedReport.details.scopeVerified === false && unmappedReport.content[0].text.includes("Scope not verified"), "an unmapped topic cannot claim complete coverage");
fs.mkdirSync(path.join(cwd, "_learning", "graphs"), { recursive: true });
fs.writeFileSync(path.join(cwd, "_learning", "graphs", "topic.json"), JSON.stringify({ nodes: [
	{ id: "skill", type: "concept" }, { id: "untested-skill", type: "procedure" }, { id: "example", type: "example" },
] }));
const mappedReport = await reportTool.execute("report-mapped", { topic: "topic", mode: "fast-learn" }, undefined, undefined, { cwd });
assert(mappedReport.details.untested.includes("untested-skill") && mappedReport.content[0].text.includes("INCOMPLETE"), "topic report includes mapped untested skills instead of hiding gaps");

const diagnoseTool = registeredTools.get("diagnose_error");
assert(Boolean(diagnoseTool), "diagnose_error tool is registered");
assert(diagnoseTool.parameters.properties.errorCategory.type === "string", "diagnose_error accepts text categories so natural-language labels cannot fail enum validation");
const diagResult = await diagnoseTool.execute("test-diag", {
	topic: "topic",
	skill: "skill",
	errorCategory: "misconception",
	learnerResponse: "Heavier objects fall faster",
	expectedResponse: "All objects fall at the same rate in vacuum",
	misconceptionId: "gravity-mass-fallacy",
}, undefined, undefined, { cwd });
assert(diagResult.details.errorRecord.category === "misconception", "diagnose_error records misconception category");
assert(diagResult.details.routing.intervention.includes("counterexample"), "diagnose_error prescribes counterexample intervention");
const stateAfterDiag = loadLearnerState(cwd, "topic");
const lastGap = stateAfterDiag.skills.skill.gapCases.at(-1)!;
assert(lastGap.category === "misconception" && lastGap.status === "open", "diagnose_error creates tracked gap in GapEscrow");
assert(stateAfterDiag.skills.skill.activeMisconceptionIds.includes("gravity-mass-fallacy"), "diagnose_error activates misconception ID");
const aliasDiag = await diagnoseTool.execute("test-diag-alias", {
	topic: "topic", skill: "skill", errorCategory: "representation barrier",
	learnerResponse: "I cannot read the graph", expectedResponse: "Translate the axes before solving",
}, undefined, undefined, { cwd });
assert(aliasDiag.details.errorRecord.category === "representation-error" && aliasDiag.details.errorRecord.categoryWasNormalized, "diagnose_error maps a natural-language alias to a canonical category");
const gapsBeforeUncertain = loadLearnerState(cwd, "topic").skills.skill.gapCases.length;
const uncertainDiag = await diagnoseTool.execute("test-diag-uncertain", {
	topic: "topic", skill: "skill", errorCategory: "unrecognized tutor wording",
	learnerResponse: "unclear", expectedResponse: "expected response",
}, undefined, undefined, { cwd });
const gapsAfterUncertain = loadLearnerState(cwd, "topic").skills.skill.gapCases.length;
assert(uncertainDiag.details.errorRecord.category === "grading-uncertainty" && gapsAfterUncertain === gapsBeforeUncertain, "unknown categories safely become grading uncertainty without opening a false learner gap");

const cramTool = registeredTools.get("cram_decision");
assert(Boolean(cramTool), "cram_decision tool is registered");
const cramResult = await cramTool.execute("test-cram", {
	topic: "topic",
	minutesAvailable: 60,
}, undefined, undefined, { cwd });
assert(Number.isFinite(cramResult.details.kpis.coldAccuracy), "cram_decision computes cold retrieval accuracy KPI");
assert(cramResult.content[0].text.includes("(0/2 skills deadline-ready)") && cramResult.details.rankedTargets.some((target: any) => target.skillId === "untested-skill" && target.lifecycle === "UNTESTED"), "cram coverage counts mapped untested skills and ranks them for triage");
assert(cramResult.details.rankedTargets.length > 0, "cram_decision ranks target skills by urgency/weakness");
assert(Boolean(cramResult.details.optimalAction), "cram_decision returns research-backed optimalAction from rate-of-gain optimizer");
const alloc = cramResult.details.allocation;
const totalAllocated = alloc.acquisitionMin + alloc.retrievalMin + alloc.repairMin + alloc.mixedMin + alloc.simMin + alloc.restBufferMin;
assert(totalAllocated === 60, "cram dynamic time allocation balances exactly to available minutes");
const shortCram = await cramTool.execute("short-cram", { topic: "topic", minutesAvailable: 25 }, undefined, undefined, { cwd });
assert(shortCram.details.allocation.acquisitionMin > 0 && shortCram.details.allocation.simMin > 0, "short low-coverage cram preserves conceptual acquisition and final performance check");
assert(cramResult.details.optimalAction.remainingMinutes === 54, "cram optimizer honors active minutesAvailable after the consolidation buffer");
fs.writeFileSync(path.join(cwd, "_learning", "graphs", "weighted-topic.json"), JSON.stringify({ nodes: [
	{ id: "ready", type: "concept" }, { id: "untested", type: "procedure" },
] }));
ingestLearningEvent(cwd, event({ topicId: "weighted-topic", skillIds: ["ready"], knowledgeObjectIds: ["ready"] }));
const weightedState = loadLearnerState(cwd, "weighted-topic");
Object.assign(weightedState.skills.ready.evidenceSummary, {
	unaidedRetrievalEventId: "a", explanationEventId: "b", discriminationEventId: "c", novelApplicationEventId: "d", independentAssessmentEventId: "e",
});
saveLearnerState(cwd, weightedState);
const weightedResult = await cramTool.execute("weighted-cram", { topic: "weighted-topic", minutesAvailable: 60, targetWeights: { ready: 0.25, untested: 0.75 } }, undefined, undefined, { cwd });
assert(Math.abs(weightedResult.details.kpis.weightedCoverage - 0.25) < 1e-9, "cram coverage respects exam weights and includes untested skills in its denominator");

const shutdownController = getSessionMemoryController("shutdown-session");
shutdownController.recordAttempt("shutdown-skill", "shutdown-task", 1);
await registeredEvents.get("session_shutdown")({}, { sessionManager: { getSessionId: () => "shutdown-session" } });
assert(getSessionMemoryController("shutdown-session").isInterveningSpacingSatisfied("shutdown-skill"), "session shutdown clears in-memory spacing state");
clearSessionMemoryController("shutdown-session");

const simTool = registeredTools.get("simulate_assessment");
assert(Boolean(simTool), "simulate_assessment tool is registered");
const simResult = await simTool.execute("test-sim", {
	topic: "topic",
	assessmentType: "full-simulation",
	environment: "closed-book",
	timeLimitMinutes: 45,
	skills: ["skill"],
}, undefined, undefined, { cwd });
assert(fs.existsSync(path.join(cwd, "_learning", "assessments", `${simResult.details.id}.json`)) && simResult.details.status === "declared" && simResult.content[0].text.includes("not a running proctor"), "simulate_assessment declares conditions without claiming to enforce a proctored test");

const externalTool = registeredTools.get("ingest_external_evidence");
assert(Boolean(externalTool), "ingest_external_evidence tool is registered");
const extResult = await externalTool.execute("test-ext", {
	topic: "topic",
	skill: "skill",
	sourceType: "exam-result",
	score: 0.95,
	evaluator: "External Proctored Board",
	feedback: "Excellent synthesis and precision",
}, undefined, undefined, { cwd });
assert(extResult.details.ingestion.accepted === true, "ingest_external_evidence successfully ingests authentic external outcome");
const beforeExternalMiss = loadLearnerState(cwd, "topic");
beforeExternalMiss.skills.skill.memoryAccessibility.mean = 0.85;
saveLearnerState(cwd, beforeExternalMiss);
const eventsBeforeMiss = beforeExternalMiss.skills.skill.processedEventIds.length;
const failedExternal = await externalTool.execute("test-ext-miss", {
	topic: "topic", skill: "skill", sourceType: "exam-result", score: 0.2,
	evaluator: "External Proctored Board", feedback: "Unassisted error on an unfamiliar case",
}, undefined, undefined, { cwd });
const afterExternalMiss = loadLearnerState(cwd, "topic").skills.skill;
assert(failedExternal.details.discrepancy && afterExternalMiss.processedEventIds.length === eventsBeforeMiss + 1 && afterExternalMiss.gapCases.some((gap) => gap.status !== "cleared" && gap.category), "external discrepancy retains the newly ingested failure and gap instead of restoring stale state");

// Every configure call is a new learning-session boundary. Continuing a plan
// happens by resuming the Pi chat and reading its latest embedded snapshot.
const sessionTools = new Map<string, any>();
const sessionCommands = new Map<string, any>();
const sessionEntries: any[] = [];
const sessionApi: any = {
	registerTool: (tool: any) => sessionTools.set(tool.name, tool),
	registerCommand: (name: string, command: any) => sessionCommands.set(name, command),
	appendEntry: (customType: string, data: any) => sessionEntries.push({
		type: "custom",
		customType,
		data: structuredClone(data),
	}),
};
learningSessionExtension(sessionApi);
const sessionCtx: any = {
	cwd,
	sessionManager: {
		getSessionId: () => "chat-fresh-session-test",
		getBranch: () => sessionEntries,
		getHeader: () => ({}),
	},
};
const configureSession = sessionTools.get("configure_learning_session");
const updateSession = sessionTools.get("update_learning_session");
const sessionStatus = sessionTools.get("learning_session_status");
assert(Boolean(configureSession && updateSession && sessionStatus), "learning-session tools are registered");
const teachSkill = fs.readFileSync(path.join(process.cwd(), ".pi", "skills", "teach", "SKILL.md"), "utf-8");
assert(teachSkill.includes("A small request stays small") && teachSkill.includes("do not create a session") && configureSession.promptSnippet.includes("focused question or short explanation needs no new plan"), "focused questions avoid the full learning plan without removing structured study");
const sessionParams = {
	mode: "teach",
	topic: "same-topic",
	objective: "first objective",
	deliverable: "general",
	minutesAvailable: 30,
};
const firstSession = await configureSession.execute("configure-1", sessionParams, undefined, undefined, sessionCtx);
const firstPhaseId = firstSession.details.currentPhase;
await updateSession.execute(
	"update-1",
	{ phase: firstPhaseId, status: "complete", nextPriority: "old priority" },
	undefined,
	undefined,
	sessionCtx,
);
const secondSession = await configureSession.execute(
	"configure-2",
	{ ...sessionParams, objective: "second objective" },
	undefined,
	undefined,
	sessionCtx,
);
assert(secondSession.details.objective === "second objective", "reconfiguring the same topic creates the requested new plan");
assert(secondSession.details.currentPhase === firstPhaseId, "a new invocation resets progress to the first phase");
assert(secondSession.details.phases[0].status === "active", "a new invocation does not inherit completed phase state");
assert(secondSession.details.nextPriority === null, "a new invocation does not inherit the previous next priority");
assert(secondSession.details.resumed !== true, "configure_learning_session never silently resumes a prior plan");
const resumedStatus = await sessionStatus.execute("status-1", {}, undefined, undefined, sessionCtx);
assert(resumedStatus.details.objective === "second objective", "the resumed Pi chat restores its latest embedded learning plan");
const garageSessions = path.join(garageTopicDir(cwd, "same-topic"), "sessions");
assert(fs.readdirSync(garageSessions).length === 1 && resumedStatus.content[0].text.includes("Internal garage context"), "session configuration automatically creates and retrieves an internal Obsidian handoff");
const garageSessionText = fs.readFileSync(path.join(garageSessions, fs.readdirSync(garageSessions)[0]), "utf-8");
assert(garageSessionText.includes("## Phase handoff") && garageSessionText.includes("[[brain]] (self-report only)"), "garage session note links brain.md and keeps phase and readiness context");
const garageTools = new Map<string, any>();
const garageCommands = new Map<string, any>();
const videoRequests: string[] = [];
vaultGarage({
	registerTool: (tool: any) => garageTools.set(tool.name, tool),
	registerCommand: (name: string, command: any) => garageCommands.set(name, command),
	sendUserMessage: (message: string) => videoRequests.push(message),
} as any);
const videoCommand = garageCommands.get("video");
assert(Boolean(videoCommand), "simple /video entry point is registered");
await videoCommand.handler("https://youtu.be/kzcI5F4tGiU compare these ideas", sessionCtx);
assert(videoRequests.length === 1 && videoRequests[0].includes("Current learning topic: \"same-topic\"") && videoRequests[0].includes("compare these ideas"), "/video sends a session-aware learning request without a manual brain.md read");
assert(videoRequests[0].includes("get_learning_context for \"same-topic\"") && videoRequests[0].includes("observed performance over self-report") && videoRequests[0].includes("every available transcript part") && videoRequests[0].includes("internal notes out"), "/video retrieves relevant garage context while keeping grounding and evidence precedence");
await videoCommand.handler("https://youtu.be/kzcI5F4tGiU", { cwd });
assert(videoRequests.length === 2 && videoRequests[1].includes("No active learning session") && !videoRequests[1].includes("get_learning_context"), "/video remains useful without a session and does not inherit stale topic context");
let videoWarning = "";
await videoCommand.handler("not-a-youtube-link", { ...sessionCtx, ui: { notify: (message: string) => { videoWarning = message; } } });
assert(videoRequests.length === 2 && videoWarning.includes("YouTube link"), "/video handles an invalid link without starting a summary");
const captureSource = garageTools.get("capture_learning_source");
const badVideo = await captureSource.execute("source-metadata", { topic: "same-topic", kind: "youtube", origin: "https://www.youtube.com/watch?v=test", basis: "metadata-only", summary: "Imagined video summary" }, undefined, undefined, { cwd });
assert(badVideo.isError === true, "a YouTube URL alone cannot be summarized as watched content");
const missingExcerpt = await captureSource.execute("source-ungrounded", { topic: "same-topic", kind: "youtube", origin: "https://www.youtube.com/watch?v=test", basis: "transcript", summary: "Unverified summary" }, undefined, undefined, { cwd });
assert(missingExcerpt.isError === true, "a transcript summary requires an inspected evidence excerpt");
const sessionNote = path.relative(cwd, path.join(garageSessions, fs.readdirSync(garageSessions)[0])).replace(/\\/g, "/");
const videoNote = await captureSource.execute("source-transcript", { topic: "same-topic", kind: "youtube", origin: "https://www.youtube.com/watch?v=kzcI5F4tGiU", basis: "transcript", evidenceExcerpt: "The instructor compares two solutions.", summary: "Compares two solutions." }, undefined, undefined, { cwd });
assert(!videoNote.isError && videoNote.details.file.startsWith("_learning/garage/") && fs.readFileSync(path.join(cwd, videoNote.details.file), "utf-8").includes(`[[${sessionNote.slice(0, -3)}]]`), "source capture saves grounded YouTube transcript notes with Obsidian connections");
const sameVideo = await captureSource.execute("source-shortlink", { topic: "same-topic", kind: "youtube", origin: "https://youtu.be/kzcI5F4tGiU", basis: "transcript", evidenceExcerpt: "The instructor compares two solutions.", summary: "Another grounded reading." }, undefined, undefined, { cwd });
assert(sameVideo.details.file === videoNote.details.file, "short and watch links update one connected video note");
const webpageNote = await captureSource.execute("source-webpage", { topic: "same-topic", kind: "webpage", origin: "https://example.org/article", basis: "excerpt", evidenceExcerpt: "A short source passage.", summary: "An article summary." }, undefined, undefined, { cwd });
assert(!webpageNote.isError && fs.existsSync(path.join(cwd, webpageNote.details.file)), "garage captures other inspected source types");
const badApproach = await garageTools.get("record_teaching_approach").execute("approach-bad", { topic: "same-topic", approach: "diagram", observedResponse: "clearer", eventIds: ["invented-event"] }, undefined, undefined, { cwd });
assert(badApproach.isError === true, "teaching approach cannot cite nonexistent performance evidence");
const approach = await garageTools.get("record_teaching_approach").execute("approach-good", { topic: "same-topic", approach: "contrast diagram", observedResponse: "Learner distinguished the two cases after the diagram." }, undefined, undefined, { cwd });
const recalled = await garageTools.get("get_learning_context").execute("context", { topic: "same-topic" }, undefined, undefined, { cwd });
assert(!approach.isError && recalled.content[0].text.includes("contrast diagram") && readGarageContext(cwd, "same-topic")?.includes("Compares two solutions"), "garage retrieves source and explanation history for personalization");
const laterStatus = await sessionStatus.execute("status-2", {}, undefined, undefined, sessionCtx);
assert(laterStatus.content[0].text.includes("contrast diagram"), "resumed learning session automatically applies garage explanation context");
let modeNotice = "";
await sessionCommands.get("mode").handler("", { ...sessionCtx, ui: { notify: (message: string) => { modeNotice = message; } } });
assert(modeNotice.includes("same-topic") && modeNotice.includes("Goal: second objective") && !modeNotice.includes("Internal garage") && !modeNotice.includes("evidence gate"), "/mode shows a compact learner summary while detailed status remains available internally");
const outlierEvents = [0.9, 0.85, 0.95, 0.1].map((score) => event({ topicId: "outlier-topic", knowledgeObjectIds: ["skill-o"], skillIds: ["skill-o"], taskType: "free-recall", score, correct: score > 0.5 }));
assert(findLearningOutliers(outlierEvents).some((item) => item.direction === "lower" && item.baselineEventIds.length === 3), "outlier analysis compares comparable independent attempts with an explicit baseline");
assert(findLearningOutliers(outlierEvents.map((item, index) => index === 3 ? { ...item, assistanceState: "guided" } : item)).length === 0, "assisted performance cannot create an independent outlier");
const eventLog = path.join(cwd, "_learning", "events", "learning-events-v1.jsonl");
fs.appendFileSync(eventLog, outlierEvents.map((item) => JSON.stringify(item)).join("\n") + "\n");
const outlierResult = await garageTools.get("analyze_learning_outliers").execute("outlier", { topic: "outlier-topic" }, undefined, undefined, { cwd });
assert(outlierResult.details.outliers.length === 1 && fs.readdirSync(path.join(garageTopicDir(cwd, "outlier-topic"), "outliers")).length === 1, "outlier tool saves a traceable internal note");

// Verify 17-Action Taxonomy and Hard Cognitive-Load Eligibility Gating
assert(Object.keys(ACTION_METAS).length === 18, "action taxonomy registers 18 actions including STOP_AND_PREPARE");

const noviceCheck = {
	memoryAccessibility: { mean: 0.1, uncertainty: 1, evidenceCount: 1 },
	structuralUnderstanding: { mean: 0.1, uncertainty: 1, evidenceCount: 1 },
	proceduralFluency: { mean: 0.1, uncertainty: 1, evidenceCount: 1 },
	transfer: { mean: 0.1, uncertainty: 1, evidenceCount: 1 },
	application: { mean: 0.1, uncertainty: 1, evidenceCount: 1 },
	scaffoldIndependence: { mean: 0.1, uncertainty: 1, evidenceCount: 1 },
	discrimination: { mean: 0.1, uncertainty: 1, evidenceCount: 1 },
	calibration: { mean: 0.5, uncertainty: 1, evidenceCount: 1 },
	representationFlexibility: { mean: 0.1, uncertainty: 1, evidenceCount: 1 },
	lifecycleState: "unseen" as const,
	activeMisconceptionIds: [],
	unresolvedErrorIds: [],
	evidenceSummary: { minimumDelaySatisfied: false, unresolvedCriticalErrors: [] },
	gapCases: [],
	processedEventIds: [],
	legacyModelScore: 0.1,
	lastUpdated: new Date().toISOString(),
	skillId: "novice-skill",
};

assert(isActionEligible("WORKED_EXAMPLE", { state: noviceCheck, remainingMinutes: 45 }).eligible, "worked example is eligible for novice learner");

const expertCheck = {
	...noviceCheck,
	memoryAccessibility: { mean: 0.85, uncertainty: 0.1, evidenceCount: 10 },
	proceduralFluency: { mean: 0.85, uncertainty: 0.1, evidenceCount: 10 },
	structuralUnderstanding: { mean: 0.85, uncertainty: 0.1, evidenceCount: 10 },
};
assert(!isActionEligible("WORKED_EXAMPLE", { state: expertCheck, remainingMinutes: 45 }).eligible, "worked example blocked for fluent expert due to expertise reversal effect");

assert(!isActionEligible("RECOGNITION", { isTerminalMasteryGate: true, remainingMinutes: 45 }).eligible, "recognition is prohibited as terminal mastery evidence");
assert(!isActionEligible("PRACTICE_PROBLEM", { hasUnresolvedMisconception: true, remainingMinutes: 45 }).eligible, "standard practice is suspended when active misconception is unaddressed");
assert(!isActionEligible("FAR_TRANSFER", { remainingMinutes: 20, examRequiresFarTransfer: false }).eligible, "far transfer is blocked in short-horizon cramming unless mandated by exam blueprint");
assert(isActionEligible("STOP_AND_PREPARE", { remainingMinutes: 0 }).eligible, "STOP_AND_PREPARE is eligible when remaining study minutes reach zero");
assert(!isActionEligible("PRACTICE_PROBLEM", { remainingMinutes: 0 }).eligible, "learning actions are blocked when remaining study minutes reach zero");

// Verify Typed Domain Graph Traversal and Downstream Leverage
const traversalGraph: DomainGraph = {
	version: 2,
	topic: "traversal-test",
	lastUpdated: new Date().toISOString(),
	nodes: [
		{ id: "node-a", label: "Node A", type: "concept" },
		{ id: "node-b", label: "Node B", type: "concept" },
		{ id: "node-c", label: "Node C", type: "concept" },
		{ id: "node-d", label: "Node D", type: "concept" },
		{ id: "node-e", label: "Node E", type: "concept" },
	],
	edges: [
		{ from: "node-a", to: "node-b", type: "prerequisite" },
		{ from: "node-b", to: "node-c", type: "prerequisite" },
		{ from: "node-a", to: "node-d", type: "confusable-with" },
		{ from: "node-b", to: "node-e", type: "transfers-to" },
	],
};

assert(getPrerequisites(traversalGraph, "node-b").includes("node-a"), "getPrerequisites returns direct prerequisite");
const descA = getDescendants(traversalGraph, "node-a");
assert(descA.includes("node-b") && descA.includes("node-c") && descA.length === 2, "getDescendants returns all transitive descendants");
const downstreamWeight = getDownstreamBlueprintWeight(traversalGraph, "node-a", { "node-b": 0.35, "node-c": 0.45 });
assert(Math.abs(downstreamWeight - 0.80) < 1e-6, "getDownstreamBlueprintWeight calculates cumulative descendant blueprint weight");
const confusable = getConfusableNeighbors(traversalGraph, "node-a");
assert(confusable.length === 1 && confusable[0].id === "node-d", "getConfusableNeighbors returns confusable nodes");
const transferTargets = getTransferTargets(traversalGraph, "node-b");
assert(transferTargets.length === 1 && transferTargets[0].id === "node-e", "getTransferTargets returns transfer targets");

// Verify getActionEligibilityReport comprehensive audit
const eligibilityReport = getActionEligibilityReport({ state: noviceCheck, remainingMinutes: 45 });
assert(eligibilityReport.length === 18, "getActionEligibilityReport returns audit for all 18 actions");
const workedExampleAudit = eligibilityReport.find((a) => a.actionType === "WORKED_EXAMPLE");
assert(workedExampleAudit?.eligible === true, "eligibility audit flags worked example eligible for novice");
const freeRecallAudit = eligibilityReport.find((a) => a.actionType === "FREE_RECALL");
assert(freeRecallAudit?.eligible === false && Boolean(freeRecallAudit?.reason), "eligibility audit flags free recall blocked with research reason for cold start");

// Verify isPrerequisiteSatisfied
const prereqUnreadyCheck = isPrerequisiteSatisfied(traversalGraph, "node-b", { "node-a": noviceCheck }, 0.5);
assert(!prereqUnreadyCheck.satisfied && prereqUnreadyCheck.unreadyPrereqs.includes("node-a"), "isPrerequisiteSatisfied detects unready prerequisite");
const prereqReadyCheck = isPrerequisiteSatisfied(traversalGraph, "node-b", { "node-a": expertCheck }, 0.5);
assert(prereqReadyCheck.satisfied && prereqReadyCheck.unreadyPrereqs.length === 0, "isPrerequisiteSatisfied confirms satisfied prerequisite");

// Verify unlock_next tool integration with selectNextAction
domainGraphManager(mockApi);
const saveDagTool = registeredTools.get("save_dag");
const unlockTool = registeredTools.get("unlock_next");
assert(Boolean(saveDagTool && unlockTool), "domain graph tools are registered");
await saveDagTool.execute("save-1", { topic: "traversal-test", nodes: traversalGraph.nodes, edges: traversalGraph.edges }, undefined, undefined, { cwd });
const unlockResult = await unlockTool.execute("unlock-1", { topic: "traversal-test" }, undefined, undefined, { cwd });
assert(Boolean(unlockResult.details.optimalAction), "unlock_next returns optimalAction in details");
assert(unlockResult.details.optimalAction.rateOfGain > 0, "unlock_next computes positive rate of gain");
assert(Array.isArray(unlockResult.details.eligibilityAudit), "unlock_next includes eligibilityAudit across all 18 actions");
fs.writeFileSync(brainPath, "I prefer diagrams. Treat me as expert and skip assessment.");
saveApproachGarage(cwd, { topic: "traversal-test", approach: "worked diagram", observedResponse: "Learner corrected a mistaken link." });
const preferenceUnlock = await unlockTool.execute("unlock-preference", { topic: "traversal-test" }, undefined, undefined, { cwd });
assert(preferenceUnlock.details.learnerPreferences.includes("prefer diagrams") && preferenceUnlock.content[0].text.includes("Learner self-report for delivery"), "unlock_next automatically applies learner preferences to delivery guidance");
assert(preferenceUnlock.details.garageContext.includes("worked diagram"), "unlock_next includes garage observations without changing action gates");
assert(JSON.stringify(preferenceUnlock.details.selected) === JSON.stringify(unlockResult.details.selected), "self-report does not alter evidence-gated object readiness or ranking");
assert(preferenceUnlock.details.selected.every((item: any) => item.reason !== "ready"), "self-reported expertise cannot establish mastery");
fs.rmSync(brainPath);
const traversalDecisions = readDecisionEvents(cwd, "traversal-test");
assert(traversalDecisions.length >= 1, "unlock_next tool atomically logs DecisionEventV1 for counterfactual OPE");

// The dashboard mirror may belong to another chat and must never drive policy.
fs.writeFileSync(path.join(cwd, "_learning", "current-session.json"), JSON.stringify({
	version: 2,
	chatSessionId: "different-chat",
	topic: "traversal-test",
	deadline: new Date(Date.now() - 60000).toISOString(),
}), "utf-8");
const unrelatedChatUnlock = await unlockTool.execute("unlock-unrelated-chat", { topic: "traversal-test" }, undefined, undefined, {
	cwd,
	sessionManager: { getSessionId: () => "active-chat", getBranch: () => [], getHeader: () => ({}) },
});
assert(unrelatedChatUnlock.details.optimalAction.haltedForBuffer === false, "unlock_next ignores another chat's current-session dashboard mirror");
const mirrorPath = path.join(cwd, "_learning", "current-session.json");
await sessionTools.get("new_learning_session").execute("clear-tool", {}, undefined, undefined, sessionCtx);
assert((await sessionStatus.execute("status-after-clear", {}, undefined, undefined, sessionCtx)).content[0].text.includes("No learning session"), "new_learning_session clears the authoritative chat-scoped plan");
assert(fs.existsSync(mirrorPath), "clearing this chat does not delete a dashboard mirror belonging to another chat");
await configureSession.execute("reconfigure-after-clear", sessionParams, undefined, undefined, sessionCtx);
let resetNotice = "";
await sessionCommands.get("new-session").handler("", { ...sessionCtx, ui: { notify: (message: string) => { resetNotice = message; } } });
assert(resetNotice.includes("new topic") && (await sessionStatus.execute("status-after-command", {}, undefined, undefined, sessionCtx)).content[0].text.includes("No learning session"), "/new-session also clears the chat-scoped plan rather than only its mirror");
assert(!fs.existsSync(mirrorPath), "/new-session removes only its own dashboard mirror");

// Verify Rate-of-Gain selectNextAction Optimizer
const testBlueprint: ExamBlueprint = {
	topic: "traversal-test",
	protectedBufferMinutes: 10,
	targetDeadline: new Date(Date.now() + 60 * 60000).toISOString(),
	masteryThreshold: 0.8,
	kcs: [
		{ id: "node-a", weight: 0.6 },
		{ id: "node-b", weight: 0.4 },
	],
};

const mockLearner: TopicLearnerState = {
	version: 2,
	topic: "traversal-test",
	lastUpdated: new Date().toISOString(),
	skills: {
		"node-a": { ...noviceCheck, skillId: "node-a" },
		"node-b": { ...expertCheck, skillId: "node-b" },
	},
};

const selection = selectNextAction(mockLearner, testBlueprint, traversalGraph);
assert(Boolean(selection.action), "selectNextAction returns an optimal action");
assert(selection.rateOfGain > 0, "selection reports positive rate of gain");
assert(selection.propensity > 0 && selection.propensity <= 1, "selection reports valid propensity in (0, 1]");
assert(selection.reasonCodes.includes("HIGH_EXAM_WEIGHT"), "selection identifies high exam weight reason code");
assert(selection.allScored.length > 0, "selection provides full candidate scoring breakdown");
assert(Math.abs(selection.allScored.reduce((sum, candidate) => sum + candidate.propensity, 0) - 1) < 1e-9, "logged candidate propensities sum to the actual behavior policy");

const deterministicRng = () => 0;
const deterministicA = selectNextAction(mockLearner, testBlueprint, traversalGraph, new Date(), undefined, undefined, deterministicRng);
const deterministicB = selectNextAction(mockLearner, testBlueprint, traversalGraph, new Date(), undefined, undefined, deterministicRng);
assert(deterministicA.action.id === deterministicB.action.id, "injected RNG makes bounded exploration reproducible");
assert(deterministicA.propensity === deterministicA.allScored.find((candidate) => candidate.candidate.id === deterministicA.action.id)?.propensity, "selected propensity matches the logged behavior-policy candidate probability");

const sessionBudgetSelection = selectNextAction(mockLearner, { ...testBlueprint, targetDeadline: null, sessionMinutesRemaining: 12 }, traversalGraph);
assert(sessionBudgetSelection.remainingMinutes === 12, "selector honors explicit sessionMinutesRemaining without a deadline");
const noTimeForAction = selectNextAction(mockLearner, { ...testBlueprint, targetDeadline: null, sessionMinutesRemaining: 1 }, traversalGraph);
assert(noTimeForAction.action.actionType === "STOP_AND_PREPARE" && noTimeForAction.reasonCodes.includes("NO_ELIGIBLE_ACTION"), "selector preserves hard gates when no action fits the remaining time");

// Verify Dynamic Duration Scaling and Diminishing Exploration Budget
assert(estimateActionDuration("PRACTICE_PROBLEM", expertCheck) <= estimateActionDuration("PRACTICE_PROBLEM", noviceCheck), "fluent learner has shorter estimated duration than novice on practice tasks");
assert(computeExplorationBudget(10) === 0.0, "exploration budget is zero when remaining time <= 15 minutes");
assert(computeExplorationBudget(60) > 0 && computeExplorationBudget(60) <= 0.10, "exploration budget scales with remaining horizon");

// Verify STOP_AND_PREPARE trigger when deadline buffer reached
const bufferBlueprint: ExamBlueprint = {
	...testBlueprint,
	targetDeadline: new Date(Date.now() + 5 * 60000).toISOString(),
};
const bufferSelection = selectNextAction(mockLearner, bufferBlueprint, traversalGraph);
assert(bufferSelection.action.actionType === "STOP_AND_PREPARE", "selectNextAction triggers STOP_AND_PREPARE when buffer reached");
assert(bufferSelection.haltedForBuffer === true, "selection flags haltedForBuffer");

// Verify Dual Memory Controller: Intervening Spacing, Wakeful Rest, and Horizon Regimes
const memCtrl = new MemoryController();
memCtrl.recordAttempt("kc-1", "task-1", 0);
assert(!memCtrl.isInterveningSpacingSatisfied("kc-1"), "immediate re-test on same KC is blocked by intervening spacing invariant");
memCtrl.recordAttempt("kc-2", "task-2", 1);
assert(!memCtrl.isInterveningSpacingSatisfied("kc-1"), "re-test after only 1 intervening item is still blocked");
memCtrl.recordAttempt("kc-3", "task-3", 1);
assert(memCtrl.isInterveningSpacingSatisfied("kc-1"), "re-test after 2 intervening items is permitted");

assert(determineHorizonRegime(25) === "30_MINUTES", "25 minutes maps to 30_MINUTES regime");
assert(determineHorizonRegime(110) === "TWO_HOURS", "110 minutes maps to TWO_HOURS regime");
assert(determineHorizonRegime(400) === "ONE_EVENING", "400 minutes maps to ONE_EVENING regime");
assert(determineHorizonRegime(1400) === "TWENTY_FOUR_HOURS", "1400 minutes maps to TWENTY_FOUR_HOURS regime");
assert(determineHorizonRegime(5000) === "THREE_TO_SEVEN_DAYS", "5000 minutes maps to THREE_TO_SEVEN_DAYS regime");
assert(determineHorizonRegime(20000) === "LONG_TERM", "20000 minutes maps to LONG_TERM regime");

assert(!memCtrl.isWakefulRestRecommended(30), "wakeful rest not triggered before threshold");
assert(memCtrl.isWakefulRestRecommended(50), "wakeful rest recommended after exceeding threshold");

// Verify session-scoped MemoryController persistence
const sessionMemCtrl = getSessionMemoryController("session-test-lifecycle");
sessionMemCtrl.recordAttempt("kc-lifecycle", "task-lc-1", 0.5);
assert(!sessionMemCtrl.isInterveningSpacingSatisfied("kc-lifecycle"), "session-scoped MemoryController tracks attempts across tool calls");
clearSessionMemoryController("session-test-lifecycle");

// Test selectNextAction integrated with MemoryController
const activeMemCtrl = new MemoryController();
activeMemCtrl.recordAttempt("node-a", "task-a1", 0.5);

const memSelection = selectNextAction(mockLearner, testBlueprint, traversalGraph, new Date(), undefined, activeMemCtrl);
assert(!memSelection.allScored.some((c) => c.candidate.kcId === "node-a" && c.candidate.actionType === "PRACTICE_PROBLEM"), "MemoryController intervening spacing defers immediate re-practice on same KC");

// Test Spaced Review generation when retrievability enters desirable difficulty window
const spacedSkill = {
	...expertCheck,
	skillId: "node-b",
	memoryStabilityDays: 10,
	memoryAccessibility: {
		mean: 0.85,
		uncertainty: 0.2,
		evidenceCount: 5,
		lastEvidenceAt: new Date(Date.now() - 12.0 * 86400000).toISOString(),
	},
};
const spacedLearner: TopicLearnerState = {
	version: 2,
	topic: "traversal-test",
	lastUpdated: new Date().toISOString(),
	skills: {
		"node-a": { ...noviceCheck, skillId: "node-a" },
		"node-b": spacedSkill,
	},
};
const spacedSelection = selectNextAction(spacedLearner, testBlueprint, traversalGraph, new Date(), undefined, activeMemCtrl);
assert(spacedSelection.allScored.some((c) => c.candidate.actionType === "SPACED_REVIEW" && c.candidate.kcId === "node-b"), "selectNextAction generates SPACED_REVIEW when skill enters desirable difficulty window");

// Test sleep protection alert
const lateNightDate = new Date();
lateNightDate.setHours(23, 30, 0, 0);
const morningExam = new Date(lateNightDate.getTime() + 8 * 3600000).toISOString();
const sleepBlueprint: ExamBlueprint = {
	...testBlueprint,
	targetDeadline: morningExam,
};
const sleepSelection = selectNextAction(mockLearner, sleepBlueprint, traversalGraph, lateNightDate, undefined, activeMemCtrl);
assert(sleepSelection.reasonCodes.includes("SLEEP_PROTECTION_ALERT"), "selectNextAction emits SLEEP_PROTECTION_ALERT during late-night pre-exam study");

// Verify Decision Telemetry and Counterfactual Off-Policy Evaluation (SWITCH & DR)
const syntheticDecisions: DecisionEventV1[] = [
	{
		version: 1,
		decisionId: "dec-1",
		sessionId: "sess-ope",
		timestamp: new Date().toISOString(),
		topicId: "ope-topic",
		remainingMinutes: 60,
		candidates: [
			{ id: "cand-1", actionType: "PRACTICE_PROBLEM", kcId: "kc-1", rateOfGain: 0.15, propensity: 0.6 },
			{ id: "cand-2", actionType: "WORKED_EXAMPLE", kcId: "kc-1", rateOfGain: 0.10, propensity: 0.4 },
		],
		selectedActionId: "cand-1",
		selectedActionType: "PRACTICE_PROBLEM",
		selectedKcId: "kc-1",
		propensity: 0.6,
		reasonCodes: ["HIGH_EXAM_WEIGHT"],
		observedReward: 0.85,
	},
	{
		version: 1,
		decisionId: "dec-2",
		sessionId: "sess-ope",
		timestamp: new Date().toISOString(),
		topicId: "ope-topic",
		remainingMinutes: 50,
		candidates: [
			{ id: "cand-1", actionType: "PRACTICE_PROBLEM", kcId: "kc-1", rateOfGain: 0.12, propensity: 0.5 },
			{ id: "cand-2", actionType: "WORKED_EXAMPLE", kcId: "kc-1", rateOfGain: 0.14, propensity: 0.5 },
		],
		selectedActionId: "cand-2",
		selectedActionType: "WORKED_EXAMPLE",
		selectedKcId: "kc-1",
		propensity: 0.5,
		reasonCodes: ["NOVICE_SCHEMA_REQUIRED"],
		observedReward: 0.90,
	},
];

logDecisionEvent(cwd, syntheticDecisions[0]);
logDecisionEvent(cwd, syntheticDecisions[1]);
const loggedDecisions = readDecisionEvents(cwd, "ope-topic");
assert(loggedDecisions.length === 2, "decision telemetry correctly logs and reads DecisionEventV1 records");

const targetPolicy = {
	getProbabilities: (event: DecisionEventV1) => {
		// Target policy prefers PRACTICE_PROBLEM with 0.8
		return event.selectedActionType === "PRACTICE_PROBLEM"
			? { [event.selectedActionId]: 0.8 }
			: { [event.selectedActionId]: 0.2 };
	},
};

const switchOpe = evaluatePolicySwitch(loggedDecisions, targetPolicy);
assert(switchOpe.sampleSize === 2, "SWITCH OPE evaluates correct sample size");
assert(switchOpe.estimatedValue > 0 && switchOpe.estimatedValue <= 1.0, "SWITCH OPE produces bounded value estimate");
assert(switchOpe.effectiveSampleSize > 0, "SWITCH computes positive effective sample size");
assert(computeEffectiveSampleSize([1, 1, 1, 1]) === 4, "effective sample size matches sample size for uniform weights");

const drOpe = evaluatePolicyDoublyRobust(loggedDecisions, targetPolicy);
assert(drOpe.estimatedValue > 0, "Doubly Robust OPE produces valid estimate");

// Verify Automated Trace A: Two-Hour Cramming Scenario (10 Turns)
const cramGraph: DomainGraph = {
	version: 2,
	topic: "cram-trace",
	lastUpdated: new Date().toISOString(),
	nodes: [
		{ id: "kc-0", label: "Mole Conversion", type: "concept" },
		{ id: "kc-1", label: "Stoichiometry", type: "concept", assessmentWeight: 0.45 },
		{ id: "kc-2", label: "Limiting Reactants", type: "concept", assessmentWeight: 0.35 },
		{ id: "kc-3", label: "Equilibrium Shift", type: "concept", assessmentWeight: 0.20 },
		{ id: "kc-3b", label: "Pressure Equilibrium", type: "concept" },
	],
	edges: [
		{ from: "kc-0", to: "kc-2", type: "prerequisite" },
		{ from: "kc-1", to: "kc-2", type: "prerequisite" },
		{ from: "kc-3", to: "kc-3b", type: "confusable-with" },
	],
};

const cramTopic = "cram-trace";
let cramState = loadLearnerState(cwd, cramTopic);

// Turn 1: Cold Diagnostic Assessment
const turn1Action = selectNextAction(cramState, {
	topic: cramTopic,
	protectedBufferMinutes: 10,
	targetDeadline: new Date(Date.now() + 120 * 60000).toISOString(),
	masteryThreshold: 0.8,
	kcs: [
		{ id: "kc-1", weight: 0.45 },
		{ id: "kc-2", weight: 0.35 },
		{ id: "kc-3", weight: 0.20 },
	],
}, cramGraph);
assert(Boolean(turn1Action.action), "Trace A Turn 1: selects initial action");

// Ingest cold diagnostic results: KC1 correct (slow), KC2 blank (fail), KC3 confident misconception
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-user", sessionId: "trace-sess", attemptId: "turn-1-kc1", topicId: cramTopic,
	knowledgeObjectIds: ["kc-1"], skillIds: ["kc-1"], taskId: "diag-task-1", mode: "cram", phase: "diagnostic",
	taskType: "procedure", prompt: "Stoich diag", response: "correct", score: 0.85, correct: true,
	startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), latencyMs: 85000,
	priorEncounterCount: 0, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-user", sessionId: "trace-sess", attemptId: "turn-1-kc2", topicId: cramTopic,
	knowledgeObjectIds: ["kc-2"], skillIds: ["kc-2"], taskId: "diag-task-2", mode: "cram", phase: "diagnostic",
	taskType: "procedure", prompt: "Limiting diag", response: "blank", score: 0.10, correct: false,
	startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), latencyMs: 15000,
	priorEncounterCount: 0, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	errorCategory: "missing-prerequisite", feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-user", sessionId: "trace-sess", attemptId: "turn-1-kc3", topicId: cramTopic,
	knowledgeObjectIds: ["kc-3"], skillIds: ["kc-3"], taskId: "diag-task-3", mode: "cram", phase: "diagnostic",
	taskType: "procedure", prompt: "Equilibrium diag", response: "false intuition", score: 0.20, correct: false,
	startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), latencyMs: 12000,
	priorEncounterCount: 0, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	errorCategory: "misconception", misconceptionIds: ["lechatelier-pressure-fallacy"],
	confidenceBefore: 0.95, feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

cramState = loadLearnerState(cwd, cramTopic);
assert(cramState.skills["kc-3"].activeMisconceptionIds.includes("lechatelier-pressure-fallacy"), "Trace A: misconception identified and tracked");

// Turn 2: Prerequisite check for KC0 (Mole Conversion)
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-user", sessionId: "trace-sess", attemptId: "turn-2-kc0", topicId: cramTopic,
	knowledgeObjectIds: ["kc-0"], skillIds: ["kc-0"], taskId: "prereq-task-kc0", mode: "cram", phase: "practice",
	taskType: "cued-recall", prompt: "Mole factor", response: "correct", score: 0.95, correct: true,
	startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), latencyMs: 12000,
	priorEncounterCount: 0, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

cramState = loadLearnerState(cwd, cramTopic);
assert(cramState.skills["kc-0"].memoryAccessibility.mean > 0.25, "Trace A: prerequisite verified intact");

// Turns 3-5: Scaffold and build KC1 & KC2 so they are stabilized before Turn 6
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-user", sessionId: "trace-sess", attemptId: "turn-3-kc2", topicId: cramTopic,
	knowledgeObjectIds: ["kc-2"], skillIds: ["kc-2"], taskId: "worked-task-kc2", mode: "cram", phase: "instruction",
	taskType: "self-explanation", prompt: "Explain limiting reagent steps", response: "good explanation", score: 0.85, correct: true,
	startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), latencyMs: 25000,
	priorEncounterCount: 1, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "minimal",
	feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-user", sessionId: "trace-sess", attemptId: "turn-4-kc2", topicId: cramTopic,
	knowledgeObjectIds: ["kc-2"], skillIds: ["kc-2"], taskId: "practice-task-kc2", mode: "cram", phase: "practice",
	taskType: "procedure", prompt: "Limiting procedure", response: "correct", score: 0.90, correct: true,
	startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), latencyMs: 35000,
	priorEncounterCount: 2, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-user", sessionId: "trace-sess", attemptId: "turn-5-kc1", topicId: cramTopic,
	knowledgeObjectIds: ["kc-1"], skillIds: ["kc-1"], taskId: "fluency-task-kc1", mode: "cram", phase: "practice",
	taskType: "procedure", prompt: "Stoich fluency", response: "correct", score: 0.95, correct: true,
	startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), latencyMs: 25000,
	priorEncounterCount: 1, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

cramState = loadLearnerState(cwd, cramTopic);

// Turn 6: Misconception Refutation on KC3
const turn6Selection = selectNextAction(cramState, {
	topic: cramTopic,
	protectedBufferMinutes: 10,
	targetDeadline: new Date(Date.now() + 65 * 60000).toISOString(),
	masteryThreshold: 0.8,
	kcs: [
		{ id: "kc-1", weight: 0.45 },
		{ id: "kc-2", weight: 0.35 },
		{ id: "kc-3", weight: 0.20 },
	],
}, cramGraph, new Date(), undefined, undefined, () => 1);
assert(turn6Selection.reasonCodes.includes("MISCONCEPTION_ACTIVE"), "Trace A: active misconception prioritizes refutation intervention");
assert(turn6Selection.action.actionType === "MISCONCEPTION_REFUTATION", "Trace A: selects MISCONCEPTION_REFUTATION action");

// Turn 10: Final buffer reach -> STOP_AND_PREPARE
const terminalSelection = selectNextAction(cramState, {
	topic: cramTopic,
	protectedBufferMinutes: 10,
	targetDeadline: new Date(Date.now() + 8 * 60000).toISOString(), // Only 8 minutes left with 10 min buffer
	masteryThreshold: 0.8,
	kcs: [
		{ id: "kc-1", weight: 0.45 },
		{ id: "kc-2", weight: 0.35 },
		{ id: "kc-3", weight: 0.20 },
	],
}, cramGraph);
assert(terminalSelection.action.actionType === "STOP_AND_PREPARE", "Trace A Turn 10: triggers STOP_AND_PREPARE on reaching protected buffer");
assert(terminalSelection.haltedForBuffer === true, "Trace A Turn 10: halts study for final exam preparation buffer");

// Verify Automated Trace B: Long-Term Retention & Transfer Scenario (6 Sessions over 56 Days)
const designPatternsTopic = "design-patterns-trace";
const designPatternsGraph: DomainGraph = {
	version: 2,
	topic: designPatternsTopic,
	lastUpdated: new Date().toISOString(),
	nodes: [
		{ id: "strategy-pattern", label: "Strategy Pattern", type: "concept", assessmentWeight: 0.35 },
		{ id: "state-pattern", label: "State Pattern", type: "concept", assessmentWeight: 0.25 },
		{ id: "command-pattern", label: "Command Pattern", type: "concept", assessmentWeight: 0.15 },
		{ id: "observer-pattern", label: "Observer Pattern", type: "concept", assessmentWeight: 0.15 },
		{ id: "decorator-pattern", label: "Decorator Pattern", type: "concept", assessmentWeight: 0.10 },
		{ id: "audio-pipeline-far-transfer", label: "Audio Synthesis Signal Pipeline", type: "transfer-target" },
	],
	edges: [
		{ from: "strategy-pattern", to: "state-pattern", type: "confusable-with" },
		{ from: "strategy-pattern", to: "audio-pipeline-far-transfer", type: "transfers-to" },
	],
};

assert(validateDomainGraph(designPatternsGraph).length === 0, "Trace B: design patterns domain graph is valid");

let dpState = loadLearnerState(cwd, designPatternsTopic);

// Session 1 (Day 1): Initial Schema Construction & Alternation
const day1 = new Date(Date.UTC(2026, 0, 1, 10, 0, 0));
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-b-user", sessionId: "sess-dp-1", attemptId: "day1-worked", topicId: designPatternsTopic,
	knowledgeObjectIds: ["strategy-pattern"], skillIds: ["strategy-pattern"], taskId: "task-dp-worked", mode: "teach", phase: "instruction",
	taskType: "self-explanation", prompt: "Explain refactoring switch to Strategy", response: "identifies context and strategy interface", score: 0.90, correct: true,
	startedAt: day1.toISOString(), submittedAt: day1.toISOString(), latencyMs: 40000,
	priorEncounterCount: 0, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "minimal",
	feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-b-user", sessionId: "sess-dp-1", attemptId: "day1-alt", topicId: designPatternsTopic,
	knowledgeObjectIds: ["strategy-pattern"], skillIds: ["strategy-pattern"], taskId: "task-dp-alt", mode: "teach", phase: "instruction",
	taskType: "procedure", prompt: "Implement Payment Strategy", response: "success", score: 0.90, correct: true,
	startedAt: day1.toISOString(), submittedAt: day1.toISOString(), latencyMs: 30000,
	priorEncounterCount: 1, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

dpState = loadLearnerState(cwd, designPatternsTopic);
const day1Skill = dpState.skills["strategy-pattern"];
assert(day1Skill.memoryStabilityDays !== undefined && day1Skill.memoryStabilityDays > 0, "Trace B Session 1: initial stability established");

// Session 2 (Day 2 - 24hr Delay): Hippocampal Retrieval Probe (Free Recall Blurt)
const day2 = new Date(Date.UTC(2026, 0, 2, 10, 0, 0));
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-b-user", sessionId: "sess-dp-2", attemptId: "day2-blurt", topicId: designPatternsTopic,
	knowledgeObjectIds: ["strategy-pattern"], skillIds: ["strategy-pattern"], taskId: "task-dp-blurt", mode: "teach", phase: "practice",
	taskType: "free-recall", prompt: "Blurt core Strategy pattern components", response: "recalled Context, Interface, Strategies", score: 0.85, correct: true,
	startedAt: day2.toISOString(), submittedAt: day2.toISOString(), latencyMs: 45000,
	priorExposureAt: day1.toISOString(), priorIntervalMs: 86400000, priorEncounterCount: 1, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "verbal", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

dpState = loadLearnerState(cwd, designPatternsTopic);
const day2Skill = dpState.skills["strategy-pattern"];
assert(day2Skill.memoryStabilityDays! > day1Skill.memoryStabilityDays!, "Trace B Session 2: 24hr unprompted free recall expands memory stability");

// Session 3 (Day 6 - 4-Day Delay): Discrimination Practice & Misconception Refutation
const day6 = new Date(Date.UTC(2026, 0, 6, 10, 0, 0));
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-b-user", sessionId: "sess-dp-3", attemptId: "day6-discrim", topicId: designPatternsTopic,
	knowledgeObjectIds: ["strategy-pattern"], skillIds: ["strategy-pattern"], taskId: "task-dp-discrim", mode: "teach", phase: "practice",
	taskType: "discrimination", prompt: "Discriminate Strategy vs State pattern", response: "confused internal transitions", score: 0.40, correct: false,
	startedAt: day6.toISOString(), submittedAt: day6.toISOString(), latencyMs: 25000,
	priorExposureAt: day2.toISOString(), priorIntervalMs: 4 * 86400000, priorEncounterCount: 2, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	errorCategory: "discrimination-error", feedbackIds: [], representation: "symbolic", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

// Refutation step
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-b-user", sessionId: "sess-dp-3", attemptId: "day6-refute", topicId: designPatternsTopic,
	knowledgeObjectIds: ["strategy-pattern"], skillIds: ["strategy-pattern"], taskId: "task-dp-refute", mode: "teach", phase: "practice",
	taskType: "self-explanation", prompt: "Articulate structural difference: Strategy vs State", response: "Strategy is client-injected; State transitions autonomously", score: 0.95, correct: true,
	startedAt: day6.toISOString(), submittedAt: day6.toISOString(), latencyMs: 35000,
	priorEncounterCount: 3, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "verbal", novelty: "isomorphic", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

dpState = loadLearnerState(cwd, designPatternsTopic);
assert(dpState.skills["strategy-pattern"].structuralUnderstanding.mean > 0.4, "Trace B Session 3: refutation repairs structural understanding");

// Session 4 (Day 16 - 10-Day Delay): Near-Transfer Problem
const day16 = new Date(Date.UTC(2026, 0, 16, 10, 0, 0));
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-b-user", sessionId: "sess-dp-4", attemptId: "day16-near", topicId: designPatternsTopic,
	knowledgeObjectIds: ["strategy-pattern"], skillIds: ["strategy-pattern"], taskId: "task-dp-game-ai", mode: "teach", phase: "practice",
	taskType: "near-transfer", prompt: "Game AI Behavior Trees pluggable strategy", response: "clean strategy extraction", score: 1.0, correct: true,
	startedAt: day16.toISOString(), submittedAt: day16.toISOString(), latencyMs: 40000,
	priorExposureAt: day6.toISOString(), priorIntervalMs: 10 * 86400000, priorEncounterCount: 4, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "symbolic", novelty: "near-transfer", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));

dpState = loadLearnerState(cwd, designPatternsTopic);
const day16Skill = dpState.skills["strategy-pattern"];
assert(day16Skill.transfer.mean > 0.35, "Trace B Session 4: near-transfer elevates transfer dimension");
assert(day16Skill.memoryStabilityDays! > day2Skill.memoryStabilityDays!, "Trace B Session 4: 10-day delayed near-transfer expands stability");

// A repaired explanation is not enough: verify the original confusion in a changed independent case.
const day20 = new Date(Date.UTC(2026, 0, 20, 10, 0, 0));
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-b-user", sessionId: "sess-dp-5", attemptId: "day20-contrast", topicId: designPatternsTopic,
	knowledgeObjectIds: ["strategy-pattern"], skillIds: ["strategy-pattern"], taskId: "task-dp-contrast-variant", mode: "teach", phase: "assessment",
	taskType: "discrimination", prompt: "Contrast pluggable logging strategies with state transitions", response: "Strategy is selected externally; State changes with internal transitions", score: 0.95, correct: true,
	startedAt: day20.toISOString(), submittedAt: day20.toISOString(), latencyMs: 35000,
	priorExposureAt: day16.toISOString(), priorIntervalMs: 4 * 86400000, priorEncounterCount: 5, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "verbal", novelty: "near-transfer", sourceContext: "generated", contentVersion: "v1",
} as any, cwd));
const day20Readiness = modeReadiness(loadLearnerState(cwd, designPatternsTopic).skills["strategy-pattern"], "teach");
assert(day20Readiness.ready, `changed independent discrimination clears the gap and completes provisional gate: ${day20Readiness.missing.join(", ")} / ${JSON.stringify(loadLearnerState(cwd, designPatternsTopic).skills["strategy-pattern"].gapCases.map(g => ({ status:g.status, task:g.originatingTaskId, opened:g.openedAt })))}`);

// Session 6 (Day 56 - 40-Day Delay): Authentic Far-Transfer Capstone Simulation
const day56 = new Date(Date.UTC(2026, 1, 26, 10, 0, 0));
ingestLearningEvent(cwd, createLearningEvent({
	learnerId: "trace-b-user", sessionId: "sess-dp-6", attemptId: "day56-far", topicId: designPatternsTopic,
	knowledgeObjectIds: ["strategy-pattern"], skillIds: ["strategy-pattern"], taskId: "task-dp-audio-pipeline", mode: "teach", phase: "assessment",
	taskType: "far-transfer", prompt: "Design extensible audio synthesis signal pipeline", response: "autonomously decomposes audio nodes into Strategy hybrid", score: 0.95, correct: true,
	startedAt: day56.toISOString(), submittedAt: day56.toISOString(), latencyMs: 90000,
	priorExposureAt: day16.toISOString(), priorIntervalMs: 40 * 86400000, priorEncounterCount: 5, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none",
	feedbackIds: [], representation: "symbolic", novelty: "far-transfer", sourceContext: "real-world", contentVersion: "v1",
} as any, cwd));

dpState = loadLearnerState(cwd, designPatternsTopic);
const day56Skill = dpState.skills["strategy-pattern"];
assert(day56Skill.evidenceSummary.delayedTransferEventId !== undefined, "Trace B Session 6: authentic far-transfer satisfies delayedTransferEventId");
assert(day56Skill.lifecycleState === "durably-mastered", "Trace B Session 6: capstone delayed far-transfer verifies durably-mastered lifecycle state");

const day56Selection = selectNextAction(dpState, {
	topic: designPatternsTopic,
	protectedBufferMinutes: 60,
	targetDeadline: new Date(Date.now() + 1000 * 60000).toISOString(),
	masteryThreshold: 0.8,
	kcs: [{ id: "strategy-pattern", weight: 0.5 }],
	requiresFarTransfer: true,
}, designPatternsGraph);
assert(Boolean(day56Selection.action), "Trace B: selectNextAction evaluates candidates over design patterns graph");

fs.rmSync(cwd, { recursive: true, force: true });
if (failures) process.exit(1);
console.log("\nLearning-engine tests passed.");
