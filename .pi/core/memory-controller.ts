/**
 * memory-controller — dual-controller orchestration of human memory dynamics.
 *
 * Decouples:
 * 1. Intra-session Acquisition Controller (< 6 hours):
 *    - Enforces 2-3 intervening item lag before re-testing failed concepts (eliminates sensory echo).
 *    - Monitors uninterrupted high-load duration and prompts wakeful rest pauses.
 * 2. Inter-session Retention Controller (>= 24 hours):
 *    - Computes dynamic retrievability decay R(t) = 2^(-Delta t / S) across all graph nodes.
 *    - Optimizes review intervals against the empirical spacing ridgeline (Cepeda et al., 2008).
 *    - Protects nocturnal sleep consolidation before exams.
 * Reference: outputs/adaptive-learning-next-action.md Section 4.
 */

import { retrievability } from "./fsrs.ts";
import type { SkillLearnerState, TopicLearnerState } from "./learning-events.ts";

export interface RecentAttempt {
	kcId: string;
	taskId: string;
	score: number;
	timestamp: string;
}

export type HorizonRegime =
	| "30_MINUTES"
	| "TWO_HOURS"
	| "ONE_EVENING"
	| "TWENTY_FOUR_HOURS"
	| "THREE_TO_SEVEN_DAYS"
	| "LONG_TERM";

export interface HorizonPolicyConfig {
	regime: HorizonRegime;
	defaultBufferMinutes: number;
	explorationScale: number;
	minSpacingInterval: number;
	allowedActionQuadrants: Array<"instruction" | "retrieval" | "application" | "repair">;
	allowsFarTransfer: boolean;
	description: string;
}

export const HORIZON_CONFIGS: Record<HorizonRegime, HorizonPolicyConfig> = {
	"30_MINUTES": {
		regime: "30_MINUTES",
		defaultBufferMinutes: 5,
		explorationScale: 0.0, // Strict exploitation
		minSpacingInterval: 1,
		allowedActionQuadrants: ["retrieval", "application", "repair"],
		allowsFarTransfer: false, // Banned unless mandated
		description: "High-yield error repair, formula execution, cued recall; discovery and far-transfer pruned.",
	},
	"TWO_HOURS": {
		regime: "TWO_HOURS",
		defaultBufferMinutes: 10,
		explorationScale: 0.5,
		minSpacingInterval: 2,
		allowedActionQuadrants: ["instruction", "retrieval", "application", "repair"],
		allowsFarTransfer: false,
		description: "Cold diagnostic sample, worked-study alternation, mixed practice, mini-simulation.",
	},
	"ONE_EVENING": {
		regime: "ONE_EVENING",
		defaultBufferMinutes: 15,
		explorationScale: 0.8,
		minSpacingInterval: 2,
		allowedActionQuadrants: ["instruction", "retrieval", "application", "repair"],
		allowsFarTransfer: true,
		description: "Spaced interleaved cycles, self-explanation, mini-exam; sleep protected.",
	},
	"TWENTY_FOUR_HOURS": {
		regime: "TWENTY_FOUR_HOURS",
		defaultBufferMinutes: 30,
		explorationScale: 1.0,
		minSpacingInterval: 2,
		allowedActionQuadrants: ["instruction", "retrieval", "application", "repair"],
		allowsFarTransfer: true,
		description: "Evening encoding block, protected nocturnal sleep, morning check.",
	},
	"THREE_TO_SEVEN_DAYS": {
		regime: "THREE_TO_SEVEN_DAYS",
		defaultBufferMinutes: 60,
		explorationScale: 1.0,
		minSpacingInterval: 3,
		allowedActionQuadrants: ["instruction", "retrieval", "application", "repair"],
		allowsFarTransfer: true,
		description: "Expanding spaced intervals, category discrimination, transfer probes.",
	},
	"LONG_TERM": {
		regime: "LONG_TERM",
		defaultBufferMinutes: 120,
		explorationScale: 1.0,
		minSpacingInterval: 3,
		allowedActionQuadrants: ["instruction", "retrieval", "application", "repair"],
		allowsFarTransfer: true,
		description: "Full mastery graph progression, far transfer, FSRS maintenance.",
	},
};

export function getHorizonConfig(regime: HorizonRegime): HorizonPolicyConfig {
	return HORIZON_CONFIGS[regime];
}

export interface MemoryControllerConfig {
	minInterveningItems: number; // Default: 2 items
	wakefulRestThresholdMinutes: number; // Default: 45 continuous minutes
	desirableDifficultyLower: number; // 0.80
	desirableDifficultyUpper: number; // 0.90
}

export const DEFAULT_MEMORY_CONFIG: MemoryControllerConfig = {
	minInterveningItems: 2,
	wakefulRestThresholdMinutes: 45,
	desirableDifficultyLower: 0.80,
	desirableDifficultyUpper: 0.90,
};

export function determineHorizonRegime(remainingMinutes: number): HorizonRegime {
	if (remainingMinutes <= 35) return "30_MINUTES";
	if (remainingMinutes <= 150) return "TWO_HOURS";
	if (remainingMinutes <= 480) return "ONE_EVENING";
	if (remainingMinutes <= 1440) return "TWENTY_FOUR_HOURS";
	if (remainingMinutes <= 10080) return "THREE_TO_SEVEN_DAYS";
	return "LONG_TERM";
}

export class MemoryController {
	private recentAttempts: RecentAttempt[] = [];
	private continuousWorkMinutes = 0;
	private lastRestTimestamp: number;

	constructor(private config = DEFAULT_MEMORY_CONFIG, startTime = Date.now()) {
		this.lastRestTimestamp = startTime;
	}

	public getContinuousWorkMinutes(): number {
		return this.continuousWorkMinutes;
	}

	public addActiveMinutes(minutes: number): void {
		this.continuousWorkMinutes += minutes;
	}

	public getLastRestTimestamp(): number {
		return this.lastRestTimestamp;
	}

	public recordAttempt(kcId: string, taskId: string, score: number, now = new Date()): void {
		this.recentAttempts.push({
			kcId,
			taskId,
			score,
			timestamp: now.toISOString(),
		});
		if (this.recentAttempts.length > 30) {
			this.recentAttempts.shift();
		}
	}

	public registerRestPause(now = new Date()): void {
		this.continuousWorkMinutes = 0;
		this.lastRestTimestamp = now.getTime();
	}

	/**
	 * Intra-session rule: A concept failed or attempted on turn N cannot be re-tested
	 * until at least minInterveningItems (default 2) intervening items have occurred.
	 * Eliminates sensory and working-memory echo contamination.
	 * Reference: research/learning.md:144–178.
	 */
	public isInterveningSpacingSatisfied(kcId: string): boolean {
		const total = this.recentAttempts.length;
		if (total === 0) return true;

		let lastIndex = -1;
		for (let i = total - 1; i >= 0; i--) {
			if (this.recentAttempts[i].kcId === kcId) {
				lastIndex = i;
				break;
			}
		}

		if (lastIndex === -1) return true;
		const intervening = total - 1 - lastIndex;
		return intervening >= this.config.minInterveningItems;
	}

	/**
	 * Recommends wakeful rest if uninterrupted practice exceeds threshold.
	 * Reference: Dewar et al. (2014) DOI: 10.1016/j.neurobiollearn.2014.04.008.
	 */
	public isWakefulRestRecommended(currentActiveMinutes = this.continuousWorkMinutes): boolean {
		return currentActiveMinutes >= this.config.wakefulRestThresholdMinutes;
	}

	/**
	 * Inter-session calculation: Dynamic retrievability decay across all skills.
	 * Utilizes unified FSRS/half-life retrievability decay.
	 */
	public decayAllRetrievabilities(topicState: TopicLearnerState, now = new Date(), model: "fsrs" | "half-life" = "fsrs"): Record<string, number> {
		const retrievabilities: Record<string, number> = {};
		for (const [skillId, skill] of Object.entries(topicState.skills)) {
			const stability = skill.memoryStabilityDays ?? 1.0;
			let elapsedDays = 0;
			if (skill.memoryAccessibility.lastEvidenceAt) {
				const lastTime = Date.parse(skill.memoryAccessibility.lastEvidenceAt);
				if (!Number.isNaN(lastTime)) {
					elapsedDays = Math.max(0, (now.getTime() - lastTime) / 86400000);
				}
			}
			const r = retrievability(elapsedDays, stability, model);
			retrievabilities[skillId] = Math.max(0.01, Math.min(1.0, r));
		}
		return retrievabilities;
	}

	/**
	 * Checks if skill retrievability has entered the window of desirable difficulty (R in [0.80, 0.90]).
	 * Reference: Cepeda et al. (2008); Tabibian et al. (2019).
	 */
	public isDueForSpacedReview(skill: SkillLearnerState, now = new Date(), model: "fsrs" | "half-life" = "fsrs"): boolean {
		const stability = skill.memoryStabilityDays ?? 1.0;
		if (!skill.memoryAccessibility.lastEvidenceAt) return false;
		const lastTime = Date.parse(skill.memoryAccessibility.lastEvidenceAt);
		if (Number.isNaN(lastTime)) return false;
		const elapsedDays = Math.max(0, (now.getTime() - lastTime) / 86400000);
		const r = retrievability(elapsedDays, stability, model);
		return r <= this.config.desirableDifficultyUpper && r >= this.config.desirableDifficultyLower;
	}

	/**
	 * Sleep Protection: Warns or blocks recommendations if study time encroaches on bedtime.
	 * Reference: research/cramming.md:465–481.
	 */
	public isSleepProtected(targetExamTimestampIso?: string | null, now = new Date()): { protected: boolean; warning?: string } {
		if (!targetExamTimestampIso) return { protected: true };
		const examTime = Date.parse(targetExamTimestampIso);
		if (Number.isNaN(examTime)) return { protected: true };

		const hoursUntilExam = (examTime - now.getTime()) / 3600000;
		const currentHour = now.getHours();

		if ((currentHour >= 23 || currentHour < 5) && hoursUntilExam < 14) {
			return {
				protected: false,
				warning: "Sleep protection alert: Late-night study displaces restorative nocturnal consolidation before exam. Terminate session and protect sleep.",
			};
		}
		return { protected: true };
	}
}

const sessionMemoryControllers = new Map<string, MemoryController>();

export function getSessionMemoryController(sessionId: string, config = DEFAULT_MEMORY_CONFIG): MemoryController {
	let controller = sessionMemoryControllers.get(sessionId);
	if (!controller) {
		controller = new MemoryController(config);
		sessionMemoryControllers.set(sessionId, controller);
	}
	return controller;
}

export function clearSessionMemoryController(sessionId: string): void {
	sessionMemoryControllers.delete(sessionId);
}
