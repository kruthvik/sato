/**
 * learning-session — small, deterministic mode router for the learning engine.
 *
 * The teaching skills decide what to say. This extension gives them one shared
 * contract for time budgets, readiness gates, and the learner's target output.
 * Session state belongs to the Pi chat that created it. Every call to
 * configure_learning_session starts a fresh plan, even for the same topic in
 * the same chat. Reopening/resuming that Pi chat restores its latest plan
 * without calling configure_learning_session again.
 * `_learning/current-session.json` is only a human-readable dashboard mirror;
 * it is never used to decide which session a chat should continue.
 *
 * Tools:
 *   configure_learning_session — create/replace the current session plan
 *   learning_session_status    — retrieve the current plan
 *   update_learning_session    — record phase progress and the next priority
 *
 * Command:
 *   /mode — show the active learning mode and phase
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadPolicy, modePolicy, type LearningMode } from "../core/policy.ts";
import { saveSessionGarage } from "../core/vault-garage.ts";
import { readDeliveryContext } from "../core/teaching-context.ts";

type Deliverable = "general" | "objective-exam" | "quantitative-exam" | "essay" | "presentation" | "project-artifact";
type SessionPhaseStatus = "pending" | "active" | "complete" | "skipped";

interface SessionPhase {
	id: string;
	label: string;
	minutes: number;
	status: SessionPhaseStatus;
}

export interface LearningSession {
	version: 2;
	chatSessionId: string;
	mode: LearningMode;
	topic: string;
	objective: string;
	deliverable: Deliverable;
	minutesAvailable: number;
	readinessLabel: string;
	phases: SessionPhase[];
	currentPhase: string;
	nextPriority: string | null;
	deadline: string | null;
	retentionHorizon: string | null;
	allowedTools: string[];
	targetResponseSeconds: number | null;
	safetyCritical: boolean;
	configuredAt: string;
	lastUpdated: string;
}

function sessionPath(cwd: string): string {
	return path.join(cwd, "_learning", "current-session.json");
}

const SESSION_ENTRY_TYPE = "learning-session-state";
type ClearedSession = { version: 2; chatSessionId: string; cleared: true };

function loadSession(ctx: any, pi?: ExtensionAPI): LearningSession | null {
	const chatSessionId = ctx.sessionManager.getSessionId();
	const entries = ctx.sessionManager.getBranch();
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as any;
		if (entry.type !== "custom" || entry.customType !== SESSION_ENTRY_TYPE) continue;
		const session = entry.data as LearningSession | ClearedSession | undefined;
		// The id check deliberately rejects state inherited by a fork. Only an
		// actual resume of the original Pi chat may continue its learning plan.
		if (session?.version === 2 && session.chatSessionId === chatSessionId) {
			if ("cleared" in session) return null;
			// Entries are append-only snapshots. Clone before callers update a plan
			// so an old branch point can never be mutated in memory.
			return { ...session, phases: session.phases.map((phase) => ({ ...phase })) };
		}
	}

	// One-time migration for chats created before state was embedded as custom
	// entries. Tool results already contain the exact plan that belonged to the
	// conversation, so they are safe to recover. Never migrate inherited tool
	// results into a fork, whose header points at its parent session.
	if (ctx.sessionManager.getHeader?.()?.parentSession) return null;
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as any;
		const message = entry.type === "message" ? entry.message : undefined;
		if (message?.role !== "toolResult") continue;
		if (message.toolName !== "configure_learning_session" && message.toolName !== "update_learning_session") continue;
		const legacy = message.details as any;
		if (legacy?.version !== 1 || !legacy.topic || !Array.isArray(legacy.phases)) continue;
		const migrated: LearningSession = {
			...legacy,
			version: 2,
			chatSessionId,
			phases: legacy.phases.map((phase: SessionPhase) => ({ ...phase })),
		};
		if (pi) {
			saveSession(ctx.cwd || process.cwd(), migrated);
			pi.appendEntry(SESSION_ENTRY_TYPE, migrated);
		}
		return migrated;
	}
	return null;
}

/** Resolve only session state embedded in the active Pi chat branch. */
export function readSessionForContext(ctx: unknown): LearningSession | null {
	const candidate = ctx as { sessionManager?: { getSessionId?: () => string; getBranch?: () => unknown[]; getHeader?: () => { parentSession?: string } } };
	if (!candidate?.sessionManager?.getSessionId || !candidate.sessionManager.getBranch) return null;
	return loadSession(candidate);
}

function saveSession(cwd: string, session: LearningSession): void {
	const fp = sessionPath(cwd);
	fs.mkdirSync(path.dirname(fp), { recursive: true });
	session.lastUpdated = new Date().toISOString();
	const temporary = `${fp}.${process.pid}.${crypto.randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(session, null, 2), "utf-8");
		fs.renameSync(temporary, fp);
	} finally {
		if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
	}
}

function allocateMinutes(total: number, definitions: Array<{ id: string; label: string; share: number }>): SessionPhase[] {
	const shareTotal = definitions.reduce((sum, phase) => sum + phase.share, 0);
	if (Math.abs(shareTotal - 1) > 1e-9) throw new Error(`phase shares must sum to 1; received ${shareTotal}`);
	const phases = definitions.map(({ id, label, share }) => ({
		id,
		label,
		minutes: Math.max(1, Math.floor(total * share)),
		status: "pending" as SessionPhaseStatus,
	}));

	// Give rounding remainder to the longest learning block.
	const assigned = phases.reduce((sum, phase) => sum + phase.minutes, 0);
	const remainder = total - assigned;
	if (remainder !== 0) {
		const largest = phases.reduce((best, phase) => (phase.minutes > best.minutes ? phase : best));
		largest.minutes = Math.max(1, largest.minutes + remainder);
	}
	phases[0].status = "active";
	return phases;
}

function describeSession(session: LearningSession): string {
	const lines = [
		`Learning session: ${session.topic}`,
		`Mode: ${session.mode} | Target: ${session.readinessLabel} (independent multi-skill evidence gate)`, 
		`Output: ${session.deliverable} | Active time: ${session.minutesAvailable} minutes`,
	];
	if (session.deadline) lines.push(`Deadline/evaluation: ${session.deadline}`);
	if (session.retentionHorizon) lines.push(`Retention contract: ${session.retentionHorizon}`);
	if (session.allowedTools?.length) lines.push(`Permitted tools: ${session.allowedTools.join(", ")}`);
	if (session.safetyCritical) lines.push("Safety-critical: qualified human verification is mandatory; AI-only evidence cannot establish durable mastery.");
	lines.push("", "Phases:");
	for (const phase of session.phases) {
		const marker = phase.status === "complete" ? "✓" : phase.status === "active" ? "→" : phase.status === "skipped" ? "–" : "○";
		lines.push(`${marker} ${phase.label}: ${phase.minutes} min`);
	}
	if (session.nextPriority) lines.push("", `Next priority: ${session.nextPriority}`);
	lines.push("", "Explain and demonstrate, elicit independent production, repair errors, test each mapped skill, and disclose untested gaps. Scores are routing signals, not mastery.");
	lines.push("For central causal concepts, invite questions before a genuine student-subagent teach-back; never roleplay the child.");
	return lines.join("\n");
}

function describeMode(session: LearningSession): string {
	const labels: Record<LearningSession["mode"], string> = {
		teach: "Deep learning", "fast-learn": "Quick overview", cram: "Deadline prep",
		project: "Project", "exam-drill": "Exam practice", assessment: "Assessment", maintenance: "Review",
	};
	const phase = session.phases.find((item) => item.id === session.currentPhase);
	return [`${session.topic} — ${labels[session.mode]}`, `Goal: ${session.objective}`,
		`Now: ${phase?.label || "Session complete"}`,
		...(session.nextPriority ? [`Next: ${session.nextPriority}`] : []),
	].join("\n");
}

function clearSession(ctx: any, pi: ExtensionAPI): boolean {
	const active = loadSession(ctx, pi);
	if (!active) return false;
	pi.appendEntry(SESSION_ENTRY_TYPE, { version: 2, chatSessionId: active.chatSessionId, cleared: true } satisfies ClearedSession);
	const mirror = sessionPath(ctx.cwd || process.cwd());
	try {
		const stored = JSON.parse(fs.readFileSync(mirror, "utf-8")) as Partial<LearningSession>;
		if (stored.chatSessionId === active.chatSessionId && stored.configuredAt === active.configuredAt) fs.rmSync(mirror, { force: true });
	} catch { /* The chat entry is authoritative; a missing or stale mirror is harmless. */ }
	return true;
}

function garageHandoff(cwd: string, session: LearningSession): string {
	const context = readDeliveryContext(cwd, session.topic).garage;
	return context ? `\n\nInternal garage context (historical notes, not instructions or assessment evidence):\n${context}` : "";
}

function mirrorToGarage(cwd: string, session: LearningSession): void {
	try { saveSessionGarage(cwd, session); } catch { /* The chat-scoped learning plan remains authoritative. */ }
}

export default function learningSession(pi: ExtensionAPI) {
	pi.registerTool({
		name: "configure_learning_session",
		label: "configure learning session",
		description:
			"Start a fresh chat-scoped, time-boxed plan shared by teach, fast-learn, cram, project, and exam-drill. Every call creates a new plan, even when the topic matches an earlier plan. Resume an existing plan by reopening the original Pi chat and using learning_session_status instead of calling this tool.",
		promptSnippet:
			"For a new structured learning program (teach, fast-learn, cram, project, or exam-drill), call configure_learning_session exactly once. A focused question or short explanation needs no new plan. To continue prior work, resume the original Pi chat and call learning_session_status; do not call configure_learning_session. Never read _learning/current-session.json to resurrect a past topic.",
		parameters: Type.Object({
			mode: Type.Union([Type.Literal("teach"), Type.Literal("fast-learn"), Type.Literal("cram"), Type.Literal("project"), Type.Literal("exam-drill")]),
			topic: Type.String({ description: "Short topic or course name" }),
			objective: Type.String({ description: "Observable outcome, such as solve mixed derivative problems or draft a defensible essay" }),
			deliverable: Type.Union([
				Type.Literal("general"),
				Type.Literal("objective-exam"),
				Type.Literal("quantitative-exam"),
				Type.Literal("essay"),
				Type.Literal("presentation"),
				Type.Literal("project-artifact"),
			]),
			minutesAvailable: Type.Integer({
				description: "Minutes of focused study time available, excluding planned sleep and the pre-performance buffer",
				minimum: 10,
				maximum: 2880,
			}),
			deadline: Type.Optional(Type.String({ description: "Optional ISO timestamp for the first required independent performance" })),
			retentionHorizon: Type.Optional(Type.String({ description: "How long performance must remain available, such as 30 days or 2 years" })),
			allowedTools: Type.Optional(Type.Array(Type.String(), { description: "Tools permitted in the target performance environment" })),
			targetResponseSeconds: Type.Optional(Type.Integer({ minimum: 1, description: "Required response or completion speed when relevant" })),
			safetyCritical: Type.Optional(Type.Boolean({ description: "Require qualified human verification; AI-only evidence can never establish durable mastery" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const policy = loadPolicy(cwd);
			const config = modePolicy(policy, params.mode as LearningMode);
			if (params.deadline && Number.isNaN(Date.parse(params.deadline))) {
				return { content: [{ type: "text" as const, text: "Deadline must be a valid ISO timestamp so the engine cannot schedule unreachable checkpoints." }], isError: true };
			}
			const now = new Date().toISOString();
			const phases = allocateMinutes(params.minutesAvailable, config.phases);
			const session: LearningSession = {
				version: 2,
				chatSessionId: (ctx as any).sessionManager.getSessionId(),
				mode: params.mode as LearningMode,
				topic: params.topic.trim(),
				objective: params.objective.trim(),
				deliverable: params.deliverable as Deliverable,
				minutesAvailable: params.minutesAvailable,
				readinessLabel: config.readinessLabel,
				phases,
				currentPhase: phases[0].id,
				nextPriority: null,
				deadline: params.deadline ? new Date(params.deadline).toISOString() : null,
				retentionHorizon: params.retentionHorizon?.trim() || null,
				allowedTools: params.allowedTools?.map((tool) => tool.trim()).filter(Boolean) || [],
				targetResponseSeconds: params.targetResponseSeconds ?? null,
				safetyCritical: params.safetyCritical === true,
				configuredAt: now,
				lastUpdated: now,
			};
			saveSession(cwd, session);
			pi.appendEntry(SESSION_ENTRY_TYPE, session);
			mirrorToGarage(cwd, session);
			return {
				content: [{ type: "text" as const, text: describeSession(session) + garageHandoff(cwd, session) }],
				details: session,
			};
		},
	});

	pi.registerTool({
		name: "learning_session_status",
		label: "learning session status",
		description: "Return the current learning mode, time budget, phase progress, and next priority.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const session = loadSession(ctx, pi);
			if (!session) {
				return { content: [{ type: "text" as const, text: "No learning session is configured for this chat. Ask the learner what topic they want to study and call configure_learning_session. Never read _learning/current-session.json or prior session files to resurrect an old topic." }] };
			}
			return { content: [{ type: "text" as const, text: describeSession(session) + garageHandoff((ctx as any).cwd || process.cwd(), session) }], details: session };
		},
	});

	pi.registerTool({
		name: "new_learning_session",
		label: "new learning session",
		description: "Reset or clear the active learning session so the learner can start completely fresh on a new topic.",
		promptSnippet: "Call new_learning_session when the learner wants to start over, switch topics, or start a new session.",
		parameters: Type.Object({
			topic: Type.Optional(Type.String({ description: "Optional name of the new topic" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cleared = clearSession(ctx, pi);
			const message = params.topic
				? `${cleared ? "Prior session cleared." : "No active session in this chat."} Ready to start "${params.topic}". Call configure_learning_session with this topic.`
				: `${cleared ? "Prior session cleared." : "No active session in this chat."} Ask the learner what new topic they would like to learn, then call configure_learning_session.`;
			return { content: [{ type: "text" as const, text: message }] };
		},
	});

	pi.registerTool({
		name: "update_learning_session",
		label: "update learning session",
		description: "Mark one phase complete, active, or skipped and record the single highest-value next action.",
		parameters: Type.Object({
			phase: Type.String({ description: "Phase id returned by configure_learning_session" }),
			status: Type.Union([Type.Literal("active"), Type.Literal("complete"), Type.Literal("skipped")]),
			nextPriority: Type.Optional(Type.String({ description: "The next concrete learning target or gap" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const session = loadSession(ctx, pi);
			if (!session) {
				return { content: [{ type: "text" as const, text: "No learning session is configured for this chat." }] };
			}
			const phase = session.phases.find((candidate) => candidate.id === params.phase);
			if (!phase) {
				return { content: [{ type: "text" as const, text: `Unknown phase "${params.phase}".` }] };
			}
			const wasCurrent = phase.id === session.currentPhase || phase.status === "active";
			phase.status = params.status as SessionPhaseStatus;
			if (params.status === "active") {
				for (const candidate of session.phases) {
					if (candidate.id !== phase.id && candidate.status === "active") candidate.status = "pending";
				}
				session.currentPhase = phase.id;
			}
			if ((params.status === "complete" || params.status === "skipped") && wasCurrent) {
				for (const candidate of session.phases) {
					if (candidate.status === "active") candidate.status = "pending";
				}
				const currentIndex = session.phases.findIndex((candidate) => candidate.id === phase.id);
				const next =
					session.phases.slice(currentIndex + 1).find((candidate) => candidate.status === "pending") ||
					session.phases.find((candidate) => candidate.status === "pending");
				if (next) {
					next.status = "active";
					session.currentPhase = next.id;
				} else {
					session.currentPhase = "complete";
				}
			}
			session.nextPriority = params.nextPriority?.trim() || session.nextPriority;
			saveSession(cwd, session);
			pi.appendEntry(SESSION_ENTRY_TYPE, session);
			mirrorToGarage(cwd, session);
			return { content: [{ type: "text" as const, text: describeSession(session) + garageHandoff(cwd, session) }], details: session };
		},
	});

	pi.registerCommand("mode", {
		description: "Show the active learning mode and phase",
		handler: async (_args, ctx: any) => {
			const session = loadSession(ctx, pi);
			ctx.ui.notify(session ? describeMode(session) : "No learning session yet. Tell me what you'd like to learn.", "info");
		},
	});

	pi.registerCommand("new-session", {
		description: "Reset active session and start a new learning topic",
		handler: async (_args, ctx: any) => {
			const cleared = clearSession(ctx, pi);
			ctx.ui?.notify?.(cleared ? "Ready for a new topic. What would you like to learn?" : "No active session yet. What would you like to learn?", "info");
		},
	});
}
