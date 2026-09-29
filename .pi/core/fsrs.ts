export type ReviewGrade = 1 | 2 | 3 | 4;

export const FSRS4 = {
	requestRetention: 0.9,
	w: [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61],
	decayFactor: -1,
} as const;

export interface FsrsMemoryState {
	difficulty: number;
	stability: number;
	lastReview?: string;
	nextReview?: string;
	reps: number;
	lapses: number;
}

/**
 * FSRS power-law retrievability decay.
 * At elapsedDays = stability, retrievability = 0.90.
 * Reference: outputs/adaptive-learning-next-action.md Section 4.1; Tabibian et al. (2019).
 */
export function fsrsRetrievability(elapsedDays: number, stability: number): number {
	if (stability <= 0) return 0;
	return Math.pow(1 + Math.max(0, elapsedDays) / (9 * stability), FSRS4.decayFactor);
}

/**
 * Exponential half-life retrievability decay.
 * At elapsedDays = halfLifeDays, retrievability = 0.50.
 * Reference: Settles & Meeder (2016) ACL; outputs/adaptive-learning-next-action.md Section 2.1.
 */
export function halfLifeRetrievability(elapsedDays: number, halfLifeDays: number): number {
	if (halfLifeDays <= 0) return 0;
	return Math.pow(2, -Math.max(0, elapsedDays) / halfLifeDays);
}

export function retrievability(elapsedDays: number, stability: number, model: "fsrs" | "half-life" = "fsrs"): number {
	return model === "half-life" ? halfLifeRetrievability(elapsedDays, stability) : fsrsRetrievability(elapsedDays, stability);
}

export function nextIntervalDays(stability: number, targetRetention = FSRS4.requestRetention): number {
	const factor = Math.pow(targetRetention, 1 / FSRS4.decayFactor) - 1;
	return Math.max(1, Math.round(9 * stability * factor));
}

export function initialStability(difficulty = 5): number {
	return Math.max(0.5, FSRS4.w[2] * (1 - 0.3 * ((difficulty - 5) / 5)));
}

export function mapRaschToFsrsDifficulty(raschDifficulty: number): number {
	const mapped = 1.0 + 9.0 / (1.0 + Math.exp(-raschDifficulty));
	return Math.max(1.0, Math.min(10.0, mapped));
}

function initialDifficulty(grade: ReviewGrade): number {
	return Math.max(1, Math.min(10, FSRS4.w[4] - (grade - 3) * FSRS4.w[5]));
}

function updateDifficulty(difficulty: number, grade: ReviewGrade): number {
	const adjusted = difficulty - FSRS4.w[6] * (grade - 3);
	return Math.max(1, Math.min(10, FSRS4.w[7] * FSRS4.w[4] + (1 - FSRS4.w[7]) * adjusted));
}

export function successStability(stability: number, difficulty: number, recall: number, grade: ReviewGrade = 3): number {
	const modifier = grade === 4 ? FSRS4.w[16] : grade === 2 ? FSRS4.w[15] : 1;
	const next = stability * (1 + Math.exp(FSRS4.w[8]) * (11 - difficulty) * Math.pow(stability, -FSRS4.w[9]) * (Math.exp(FSRS4.w[10] * (1 - recall)) - 1)) * modifier;
	return Math.max(0.5, Math.min(next, 36500));
}

export function failedStability(difficulty: number, stability: number, recall: number): number {
	const next = FSRS4.w[11] * Math.pow(difficulty, -FSRS4.w[12]) * (Math.pow(stability + 1, FSRS4.w[13]) - 1) * Math.exp(FSRS4.w[14] * (1 - recall));
	return Math.max(0.5, Math.min(next, stability));
}

export function computeNextStability(stability: number, difficulty: number, recall: number, outcome: 0 | 1, grade?: ReviewGrade): number {
	if (outcome === 1) {
		return successStability(stability, difficulty, recall, grade ?? 3);
	}
	return failedStability(difficulty, stability, recall);
}

export function applyFsrsReview<T extends FsrsMemoryState>(state: T, grade: ReviewGrade, reviewedAt = new Date()): T {
	const elapsedDays = state.lastReview ? Math.max(0.01, (reviewedAt.getTime() - Date.parse(state.lastReview)) / 86400000) : 0;
	const recall = state.reps > 0 ? retrievability(elapsedDays, state.stability) : 1;
	if (state.reps === 0) {
		state.difficulty = initialDifficulty(grade);
		state.stability = FSRS4.w[grade - 1];
	} else {
		state.difficulty = updateDifficulty(state.difficulty, grade);
		state.stability = grade === 1 ? failedStability(state.difficulty, state.stability, recall) : successStability(state.stability, state.difficulty, recall, grade);
	}
	if (grade === 1) state.lapses++;
	state.reps++;
	state.lastReview = reviewedAt.toISOString();
	state.nextReview = new Date(reviewedAt.getTime() + nextIntervalDays(state.stability) * 86400000).toISOString();
	return state;
}
