/** Generalized learning-task scheduler with shared FSRS memory math. */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyFsrsReview, initialStability, nextIntervalDays, retrievability, type ReviewGrade } from "../core/fsrs.ts";
import { createLearningEvent, ingestLearningEvent, readLearningEvents, type LearnerDimension, type TaskType } from "../core/learning-events.ts";
import { loadPolicy, type LearningMode } from "../core/policy.ts";

interface ScheduledLearningTask {
	id: string;
	front: string;
	back: string;
	topic: string;
	skill: string;
	knowledgeObjectIds: string[];
	taskType: TaskType;
	targetDimensions: LearnerDimension[];
	itemFamilyId?: string;
	promptTemplateId: string;
	sourceMode: LearningMode;
	earliestAt: string;
	dueAt: string;
	deadline?: string | null;
	retentionHorizon?: string | null;
	importance: number;
	prerequisiteCentrality: number;
	conceptualUncertainty: number;
	confusionRisk: number;
	estimatedMinutes: number;
	expectedLearningGain: number;
	reviewDebtCost: number;
	schedulerModel: "fsrs" | "conceptual" | "deadline" | "simulation" | "external";
	difficulty: number;
	stability: number;
	lastReview: string;
	nextReview: string;
	reps: number;
	lapses: number;
	tags: string[];
	createdAt: string;
}
interface TasksFile { version: 2; tasks: ScheduledLearningTask[]; lastUpdated: string; }

function filePath(cwd: string): string { return path.join(cwd, "_learning", "reviews", "tasks.json"); }
function legacyPath(cwd: string): string { return path.join(cwd, "_learning", "reviews", "cards.json"); }
function taskType(value?: string): TaskType { return (value || "free-recall") as TaskType; }
function defaultDimensions(type: TaskType): LearnerDimension[] {
	if (type === "discrimination") return ["discrimination"];
	if (["near-transfer", "far-transfer"].includes(type)) return ["transfer", "application"];
	if (type === "self-explanation") return ["structuralUnderstanding"];
	if (type === "representation-conversion") return ["representationFlexibility"];
	if (type === "procedure") return ["application", "proceduralFluency"];
	return ["memoryAccessibility"];
}
function migrateCard(card: any): ScheduledLearningTask {
	const type = taskType(card.taskType);
	return {
		id: card.id || crypto.randomUUID(), front: card.front, back: card.back, topic: card.topic, skill: card.skill,
		knowledgeObjectIds: card.knowledgeObjectIds || [card.skill], taskType: type, targetDimensions: card.targetDimensions || defaultDimensions(type),
		itemFamilyId: card.itemFamilyId, promptTemplateId: card.promptTemplateId || "legacy-card", sourceMode: card.sourceMode || "teach",
		earliestAt: card.earliestAt || card.createdAt || new Date().toISOString(), dueAt: card.dueAt || card.nextReview,
		deadline: card.deadline || null, retentionHorizon: card.retentionHorizon || null, importance: card.importance ?? 0.5,
		prerequisiteCentrality: card.prerequisiteCentrality ?? 0.5, conceptualUncertainty: card.conceptualUncertainty ?? 0.5,
		confusionRisk: card.confusionRisk ?? 0, estimatedMinutes: card.estimatedMinutes ?? 1, expectedLearningGain: card.expectedLearningGain ?? 0.2,
		reviewDebtCost: card.reviewDebtCost ?? 0.5, schedulerModel: card.schedulerModel || "fsrs", difficulty: card.difficulty ?? 5,
		stability: card.reps > 0 ? (card.stability ?? initialStability(card.difficulty ?? 5)) : 0, lastReview: card.lastReview || card.createdAt || new Date().toISOString(),
		nextReview: card.nextReview || card.dueAt || new Date().toISOString(), reps: card.reps || 0, lapses: card.lapses || 0,
		tags: card.tags || [], createdAt: card.createdAt || new Date().toISOString(),
	};
}
function loadTasks(cwd: string): TasksFile {
	for (const file of [filePath(cwd), legacyPath(cwd)]) {
		if (!fs.existsSync(file)) continue;
		try {
			const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
			const source = parsed.tasks || parsed.cards || [];
			return { version: 2, tasks: source.map(migrateCard), lastUpdated: parsed.lastUpdated || new Date().toISOString() };
		} catch { /* try next source */ }
	}
	return { version: 2, tasks: [], lastUpdated: new Date().toISOString() };
}
function saveTasks(cwd: string, data: TasksFile): void {
	fs.mkdirSync(path.dirname(filePath(cwd)), { recursive: true });
	data.lastUpdated = new Date().toISOString();
	fs.writeFileSync(filePath(cwd), JSON.stringify(data, null, 2), "utf-8");
	// Compatibility mirror: browser memorization can still read atomic tasks.
	const cards = data.tasks.filter((task) => task.schedulerModel === "fsrs").map((task) => ({ ...task, nextReview: task.dueAt || task.nextReview }));
	fs.writeFileSync(legacyPath(cwd), JSON.stringify({ version: 2, cards, lastUpdated: data.lastUpdated }, null, 2), "utf-8");
}
function priority(task: ScheduledLearningTask, now: number): number {
	const dueAt = Date.parse(task.dueAt || task.nextReview);
	const overdueDays = Math.max(0, now - dueAt) / 86400000;
	const deadlineMs = task.deadline ? Date.parse(task.deadline) - now : Infinity;
	const urgency = Number.isFinite(deadlineMs) ? 1 + Math.max(0, 1 - deadlineMs / 172800000) * 2 : 1 + Math.min(2, overdueDays);
	return urgency * task.importance * (0.5 + task.prerequisiteCentrality) * (0.5 + task.conceptualUncertainty) * (1 + task.confusionRisk) * Math.max(0.05, task.expectedLearningGain) / Math.max(0.25, task.estimatedMinutes);
}
function dueNote(cwd: string, data: TasksFile): void {
	const now = Date.now();
	const due = data.tasks.filter((task) => Date.parse(task.earliestAt) <= now && Date.parse(task.dueAt || task.nextReview) <= now).sort((a, b) => priority(b, now) - priority(a, now));
	const lines = ["---", "tags: [learning/reviews]", `updated: ${new Date().toISOString()}`, "---", "# Due learning tasks", "", "> Ordered by expected durable competence gain per minute, not age alone.", "", "| Task | Type | Reason | Minutes |", "|---|---|---|---:|", ...due.map((task) => `| ${task.front.replace(/\|/g, "\\|")} | ${task.taskType} | ${task.targetDimensions.join(", ")} | ${task.estimatedMinutes} |`)];
	fs.writeFileSync(path.join(path.dirname(filePath(cwd)), "due-today.md"), lines.join("\n"), "utf-8");
}
const TASK_TYPES = ["exposure", "recognition", "cued-recall", "free-recall", "self-explanation", "discrimination", "prediction", "procedure", "representation-conversion", "analogy", "error-diagnosis", "near-transfer", "far-transfer", "simulation", "authentic-performance"] as const;
const DIMENSIONS = ["memoryAccessibility", "structuralUnderstanding", "discrimination", "application", "transfer", "representationFlexibility", "proceduralFluency", "scaffoldIndependence", "calibration"] as const;
function literals(values: readonly string[]) { return Type.Union(values.map((value) => Type.Literal(value)) as any); }

export default function scheduler(pi: ExtensionAPI) {
	pi.registerTool({
		name: "schedule_review", label: "schedule learning task",
		description: "Schedule a fact, explanation, procedure, discrimination, representation conversion, analogy, error pattern, transfer case, simulation, or authentic task. Atomic retrieval uses shared FSRS; conceptual work uses explicit policies.",
		promptSnippet: "Schedule complete learning objects, not only cards. Include the target dimension, expected gain, cost, importance, centrality, uncertainty, and deadline when known.",
		parameters: Type.Object({
			front: Type.String(), back: Type.String(), topic: Type.String(), skill: Type.String(), taskType: Type.Optional(literals(TASK_TYPES)),
			knowledgeObjectIds: Type.Optional(Type.Array(Type.String())), targetDimensions: Type.Optional(Type.Array(literals(DIMENSIONS))),
			itemFamilyId: Type.Optional(Type.String()), promptTemplateId: Type.Optional(Type.String()),
			difficulty: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })), tags: Type.Optional(Type.Array(Type.String())),
			sourceMode: Type.Optional(literals(["teach", "fast-learn", "cram", "project", "assessment", "maintenance", "exam-drill"])),
			firstReviewMinutes: Type.Optional(Type.Integer({ minimum: 2, maximum: 1440 })), deadline: Type.Optional(Type.String()), retentionHorizon: Type.Optional(Type.String()),
			importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), prerequisiteCentrality: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
			conceptualUncertainty: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), confusionRisk: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
			estimatedMinutes: Type.Optional(Type.Number({ exclusiveMinimum: 0 })), expectedLearningGain: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), reviewDebtCost: Type.Optional(Type.Number({ minimum: 0 })),
			schedulerModel: Type.Optional(literals(["fsrs", "conceptual", "deadline", "simulation", "external"])),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			if (params.deadline && Number.isNaN(Date.parse(params.deadline))) return { content: [{ type: "text" as const, text: "Deadline must be a valid timestamp." }], isError: true };
			const data = loadTasks(cwd); const now = new Date(); const type = taskType(params.taskType);
			const model = (params.schedulerModel || (["recognition", "cued-recall", "free-recall"].includes(type) ? "fsrs" : params.deadline ? "deadline" : "conceptual")) as ScheduledLearningTask["schedulerModel"];
			const existing = data.tasks.find((task) => task.topic === params.topic.trim() && task.skill === params.skill.trim() && task.front.toLocaleLowerCase() === params.front.trim().toLocaleLowerCase() && task.taskType === type);
			const delayMs = params.firstReviewMinutes ? params.firstReviewMinutes * 60000 : model === "fsrs" ? nextIntervalDays(initialStability(params.difficulty || 5)) * 86400000 : 86400000;
			const dueAt = new Date(now.getTime() + delayMs);
			if (params.deadline && dueAt > new Date(params.deadline)) dueAt.setTime(Math.max(now.getTime() + 120000, Date.parse(params.deadline) - 900000));
			const task = existing || migrateCard({ id: crypto.randomUUID(), front: params.front.trim(), back: params.back.trim(), topic: params.topic.trim(), skill: params.skill.trim(), createdAt: now.toISOString(), nextReview: dueAt.toISOString(), dueAt: dueAt.toISOString() });
			Object.assign(task, { front: params.front.trim(), back: params.back.trim(), knowledgeObjectIds: params.knowledgeObjectIds?.length ? params.knowledgeObjectIds : [params.skill.trim()], taskType: type, targetDimensions: params.targetDimensions?.length ? params.targetDimensions : defaultDimensions(type), itemFamilyId: params.itemFamilyId, promptTemplateId: params.promptTemplateId || task.promptTemplateId || "default", sourceMode: params.sourceMode || "teach", earliestAt: now.toISOString(), dueAt: dueAt.toISOString(), nextReview: dueAt.toISOString(), deadline: params.deadline ? new Date(params.deadline).toISOString() : null, retentionHorizon: params.retentionHorizon || null, importance: params.importance ?? 0.5, prerequisiteCentrality: params.prerequisiteCentrality ?? 0.5, conceptualUncertainty: params.conceptualUncertainty ?? 0.5, confusionRisk: params.confusionRisk ?? 0, estimatedMinutes: params.estimatedMinutes ?? 1, expectedLearningGain: params.expectedLearningGain ?? 0.2, reviewDebtCost: params.reviewDebtCost ?? 0.5, schedulerModel: model, difficulty: params.difficulty ?? task.difficulty, tags: [...new Set([...(task.tags || []), ...(params.tags || [])])] });
			if (!existing) data.tasks.push(task); saveTasks(cwd, data); dueNote(cwd, data);
			return { content: [{ type: "text" as const, text: `${existing ? "Updated" : "Scheduled"} ${type} task for ${params.topic}/${params.skill}; due ${task.dueAt}. Reason: target ${task.targetDimensions.join(", ")} at expected gain ${task.expectedLearningGain} in ${task.estimatedMinutes} minute(s).` }], details: { task, merged: Boolean(existing) } };
		},
	});

	pi.registerTool({
		name: "get_due_reviews", label: "due learning tasks", description: "Select due tasks by transparent expected durable gain per minute under deadline and review-debt constraints.",
		parameters: Type.Object({ topic: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const data = loadTasks((ctx as any).cwd || process.cwd()); const now = Date.now();
			const due = data.tasks.filter((task) => (!params.topic || task.topic === params.topic) && Date.parse(task.earliestAt) <= now && Date.parse(task.dueAt || task.nextReview) <= now && (!task.deadline || Date.parse(task.deadline) >= now)).sort((a, b) => priority(b, now) - priority(a, now)).slice(0, params.limit || 10);
			if (!due.length) return { content: [{ type: "text" as const, text: "No reachable learning tasks are due." }] };
			const lines = [`${due.length} task(s) due, ranked by expected gain per minute:`, ...due.map((task) => `• ${task.front} [${task.taskType}] — priority ${priority(task, now).toFixed(3)}; targets ${task.targetDimensions.join(", ")}; ~${task.estimatedMinutes} min${task.deadline ? `; deadline ${task.deadline}` : ""}`)];
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { dueTasks: due } };
		},
	});

	pi.registerTool({
		name: "record_review", label: "record scheduled task", description: "Record a scheduled task result, update shared FSRS where applicable, and atomically emit learning evidence.",
		parameters: Type.Object({ cardId: Type.String({ description: "Scheduled task ID (legacy name retained)" }), grade: Type.Integer({ minimum: 1, maximum: 4 }), response: Type.Optional(Type.Any()), latencyMs: Type.Optional(Type.Integer({ minimum: 0 })), confidenceBefore: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd(); const data = loadTasks(cwd); const task = data.tasks.find((candidate) => candidate.id === params.cardId);
			if (!task) return { content: [{ type: "text" as const, text: `Task not found: ${params.cardId}` }], isError: true };
			const now = new Date(); const priorReview = task.lastReview; const grade = params.grade as ReviewGrade;
			if (task.schedulerModel === "fsrs") { applyFsrsReview(task, grade, now); task.dueAt = task.nextReview; }
			else { task.reps++; if (grade === 1) task.lapses++; task.lastReview = now.toISOString(); const days = grade === 1 ? 1 : grade === 2 ? 2 : grade === 3 ? 7 : 14; task.dueAt = new Date(now.getTime() + days * 86400000).toISOString(); task.nextReview = task.dueAt; }
			saveTasks(cwd, data); dueNote(cwd, data);
			const history = readLearningEvents(cwd, task.topic).filter((event) => event.skillIds.includes(task.skill)); const submittedAt = now.toISOString(); const startedAt = new Date(now.getTime() - (params.latencyMs || 0)).toISOString();
			const event = createLearningEvent({ learnerId: "local-learner", sessionId: (ctx as any).sessionManager?.getSessionId?.() || "review-session", attemptId: crypto.randomUUID(), topicId: task.topic, knowledgeObjectIds: task.knowledgeObjectIds, skillIds: [task.skill], taskId: task.id, itemFamilyId: task.itemFamilyId, mode: "maintenance", phase: "review", taskType: task.taskType, prompt: task.front, response: params.response ?? `[grade ${grade}]`, score: grade === 1 ? 0 : grade === 2 ? 0.7 : grade === 3 ? 0.85 : 1, correct: grade > 1, startedAt, submittedAt, latencyMs: params.latencyMs || 0, priorExposureAt: priorReview, priorIntervalMs: Math.max(0, Date.parse(startedAt) - Date.parse(priorReview)), priorEncounterCount: history.length, confidenceBefore: params.confidenceBefore, hintsRequested: 0, maximumHintDepth: 0, assistanceState: "none", feedbackIds: [], representation: task.taskType === "procedure" ? "procedural" : "verbal", novelty: task.reps > 1 ? "isomorphic" : "repeated", sourceContext: "generated", errorCategory: grade === 1 ? "memory-failure" : undefined, contentVersion: task.promptTemplateId }, cwd);
			const ingestion = ingestLearningEvent(cwd, event);
			return { content: [{ type: "text" as const, text: `Recorded ${task.taskType} task as grade ${grade}. Next due ${task.dueAt}. Evidence ${ingestion.accepted ? "accepted" : `rejected: ${ingestion.errors.join("; ")}`}.` }], details: { task, ingestion } };
		},
	});

	pi.registerTool({
		name: "review_stats", label: "learning queue stats", description: "Report review debt, projected workload, and sustainable new-material capacity.", parameters: Type.Object({ dailyMinutes: Type.Optional(Type.Integer({ minimum: 1 })) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd(); const data = loadTasks(cwd); const now = Date.now(); const daily = params.dailyMinutes || 30;
			const overdue = data.tasks.filter((task) => Date.parse(task.dueAt) <= now); const debtMinutes = overdue.reduce((sum, task) => sum + task.estimatedMinutes * task.importance, 0);
			const nextWeek = data.tasks.filter((task) => Date.parse(task.dueAt) <= now + 7 * 86400000).reduce((sum, task) => sum + task.estimatedMinutes, 0);
			const sustainableNewMinutes = Math.max(0, daily * 7 - nextWeek); const warning = debtMinutes > loadPolicy(cwd).scheduler.reviewDebtWarningMinutes;
			const lines = [`Learning queue`, `Tasks: ${data.tasks.length}`, `Overdue: ${overdue.length}`, `Weighted review debt: ${debtMinutes.toFixed(0)} min`, `Next 7 days: ${nextWeek.toFixed(0)} min`, `Sustainable new-material capacity: ${sustainableNewMinutes.toFixed(0)} min/week`, warning ? "WARNING: maintenance obligations exceed the policy debt cap; defer new material." : "Review debt is within policy capacity."];
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { total: data.tasks.length, overdue: overdue.length, debtMinutes, nextWeekMinutes: nextWeek, sustainableNewMinutes, warning } };
		},
	});

	pi.registerCommand("reviews", { description: "Show due generalized learning tasks", handler: async (_args, ctx: any) => { const data = loadTasks(ctx.cwd || process.cwd()); const due = data.tasks.filter((task) => Date.parse(task.dueAt) <= Date.now()); ctx.ui.notify(`${due.length} learning task(s) due across ${data.tasks.length} scheduled.`, due.length ? "warning" : "success"); } });
}
