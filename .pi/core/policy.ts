import * as fs from "node:fs";
import * as path from "node:path";

export type LearningMode = "teach" | "fast-learn" | "cram" | "project" | "assessment" | "maintenance" | "exam-drill";

export interface PhasePolicy {
	id: string;
	label: string;
	share: number;
}

export interface ModePolicy {
	readinessLabel: string;
	phases: PhasePolicy[];
}

export interface LearningPolicy {
	version: string;
	eventSchemaVersion: 1;
	learnerStateVersion: number;
	policyId: string;
	successScore: number;
	modes: Record<"teach" | "fast-learn" | "cram" | "project" | "exam-drill", ModePolicy>;
	mastery: {
		minimumDelayedEvidenceMs: number;
		minimumDurableEvidenceMs: number;
		independentAssistanceStates: string[];
	};
	gapEscrow: {
		minimumInterveningEvents: number;
		minimumVerificationDelayMs: number;
		verificationNovelty: string[];
	};
	hintLadder: string[];
	scheduler: {
		version: string;
		requestRetention: number;
		explorationRate: number;
		reviewDebtWarningMinutes: number;
	};
	safetyCritical: {
		requireHumanVerification: boolean;
		allowAiOnlyDurableMastery: boolean;
	};
}

const cache = new Map<string, LearningPolicy>();

export function policyPath(cwd: string): string {
	return path.join(cwd, ".pi", "config", "learning-policy.json");
}

export function validatePolicy(value: unknown): asserts value is LearningPolicy {
	if (!value || typeof value !== "object") throw new Error("learning policy must be an object");
	const policy = value as LearningPolicy;
	if (!policy.version || !policy.policyId) throw new Error("learning policy requires version and policyId");
	if (policy.eventSchemaVersion !== 1) throw new Error("unsupported learning-event schema version");
	if (!(policy.successScore > 0 && policy.successScore <= 1)) throw new Error("successScore must be in (0, 1]");
	for (const mode of ["teach", "fast-learn", "cram", "project", "exam-drill"] as const) {
		const config = policy.modes?.[mode];
		if (!config || !Array.isArray(config.phases) || config.phases.length === 0) throw new Error(`${mode} requires phases`);
		const total = config.phases.reduce((sum, phase) => sum + phase.share, 0);
		if (Math.abs(total - 1) > 1e-9) throw new Error(`${mode} phase shares must sum to 1; received ${total}`);
		if (config.phases.some((phase) => !phase.id || !phase.label || !(phase.share > 0))) throw new Error(`${mode} phases require id, label, and positive share`);
		if (new Set(config.phases.map((phase) => phase.id)).size !== config.phases.length) throw new Error(`${mode} phase ids must be unique`);
	}
	if (!Array.isArray(policy.hintLadder) || policy.hintLadder.length !== 6) throw new Error("hint ladder must contain six graduated levels");
	if (policy.mastery.minimumDelayedEvidenceMs <= 0 || policy.mastery.minimumDurableEvidenceMs <= policy.mastery.minimumDelayedEvidenceMs) {
		throw new Error("invalid mastery retention delays");
	}
	if (policy.gapEscrow.minimumInterveningEvents < 1) throw new Error("gap verification requires at least one intervening event");
}

export function loadPolicy(cwd: string): LearningPolicy {
	const resolved = path.resolve(cwd);
	const cached = cache.get(resolved);
	if (cached) return cached;
	const file = policyPath(resolved);
	let parsed: unknown;
	try { parsed = JSON.parse(fs.readFileSync(file, "utf-8")); }
	catch (error) { throw new Error(`Cannot load learning policy at ${file}: ${(error as Error).message}`); }
	validatePolicy(parsed);
	cache.set(resolved, parsed);
	return parsed;
}

export function modePolicy(policy: LearningPolicy, mode: LearningMode): ModePolicy {
	if (mode === "assessment" || mode === "maintenance") return policy.modes.teach;
	return policy.modes[mode];
}
