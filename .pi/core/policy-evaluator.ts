/**
 * policy-evaluator — decision telemetry and counterfactual off-policy evaluation.
 *
 * Implements:
 * 1. DecisionEventV1 schema & atomic logging.
 * 2. Normalized SWITCH Off-Policy Estimator (Wang, Agarwal, & Dudik, 2017).
 * 3. Doubly Robust Estimator (Dudik, Langford, & Li, 2011).
 * 4. Effective Sample Size (N_eff) guardrails against support failure.
 * Reference: outputs/adaptive-learning-next-action.md Section 8.3.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface DecisionCandidateLog {
	id: string;
	actionType: string;
	kcId: string | null;
	rateOfGain: number;
	propensity: number;
}

export interface DecisionEventV1 {
	version: 1;
	decisionId: string;
	sessionId: string;
	timestamp: string;
	topicId: string;
	remainingMinutes: number;
	candidates: DecisionCandidateLog[];
	selectedActionId: string;
	selectedActionType: string;
	selectedKcId: string | null;
	propensity: number;
	reasonCodes: string[];
	observedReward?: number;
}

function decisionsPath(cwd: string): string {
	return path.join(cwd, "_learning", "events", "decision-events-v1.jsonl");
}

export function logDecisionEvent(cwd: string, event: DecisionEventV1): void {
	const file = decisionsPath(cwd);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf-8");
}

export function readDecisionEvents(cwd: string, topicId?: string): DecisionEventV1[] {
	const file = decisionsPath(cwd);
	if (!fs.existsSync(file)) return [];
	return fs.readFileSync(file, "utf-8")
		.split(/\r?\n/)
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const event = JSON.parse(line) as DecisionEventV1;
				return !topicId || event.topicId === topicId ? [event] : [];
			} catch {
				return [];
			}
		});
}

export interface OpeResult {
	estimatedValue: number;
	effectiveSampleSize: number;
	sampleSize: number;
	supportRatio: number;
	estimator: "SWITCH" | "DoublyRobust";
	warning?: string;
}

export interface TargetPolicyEvaluator {
	getProbabilities(event: DecisionEventV1): Record<string, number>;
	predictReward?(event: DecisionEventV1, actionId: string): number;
}

/**
 * Computes Effective Sample Size: N_eff = (sum w_i)^2 / sum(w_i^2)
 */
export function computeEffectiveSampleSize(weights: number[]): number {
	const sumW = weights.reduce((sum, w) => sum + w, 0);
	const sumW2 = weights.reduce((sum, w) => sum + w * w, 0);
	if (sumW2 <= 0) return 0;
	return (sumW * sumW) / sumW2;
}

/**
 * Normalized SWITCH Estimator:
 * V_SWITCH = (1/N) * sum_{t=1}^N [ (pi(a_t|s_t) / pi_0(a_t|s_t)) * I(w_t <= tau) * (r_t - Q_hat(s_t, a_t)) + Q_hat(s_t, pi) ]
 */
export function evaluatePolicySwitch(
	events: DecisionEventV1[],
	targetPolicy: TargetPolicyEvaluator,
	tauThreshold?: number,
): OpeResult {
	const validEvents = events.filter((e) => e.observedReward !== undefined && e.propensity > 0);
	const n = validEvents.length;
	if (n === 0) {
		return {
			estimatedValue: 0,
			effectiveSampleSize: 0,
			sampleSize: 0,
			supportRatio: 0,
			estimator: "SWITCH",
			warning: "No decision events with observed rewards available for evaluation",
		};
	}

	const tau = tauThreshold ?? Math.max(2.0, Math.sqrt(n));
	const weights: number[] = [];
	let weightedSum = 0;

	for (const event of validEvents) {
		const targetProbs = targetPolicy.getProbabilities(event);
		const targetProb = targetProbs[event.selectedActionId] || 0;
		const loggingProb = event.propensity;
		const w = targetProb / loggingProb;
		weights.push(w);

		const r = event.observedReward ?? 0;
		const defaultQ = 0.5;
		const qObserved = targetPolicy.predictReward ? targetPolicy.predictReward(event, event.selectedActionId) : defaultQ;

		let qPolicyMean = 0;
		for (const cand of event.candidates) {
			const candProb = targetProbs[cand.id] || 0;
			const qCand = targetPolicy.predictReward ? targetPolicy.predictReward(event, cand.id) : defaultQ;
			qPolicyMean += candProb * qCand;
		}

		const isUnderTau = w <= tau ? 1 : 0;
		const itemEstimate = w * isUnderTau * (r - qObserved) + qPolicyMean;
		weightedSum += itemEstimate;
	}

	const nEff = computeEffectiveSampleSize(weights);
	const estimatedValue = weightedSum / n;
	const supportRatio = nEff / n;

	let warning: string | undefined;
	if (supportRatio < 0.1) {
		warning = `Insufficient policy overlap: effective sample size ratio (${(supportRatio * 100).toFixed(1)}%) drops below 10% safety guardrail`;
	}

	return {
		estimatedValue,
		effectiveSampleSize: nEff,
		sampleSize: n,
		supportRatio,
		estimator: "SWITCH",
		warning,
	};
}

/**
 * Standard Doubly Robust Estimator
 */
export function evaluatePolicyDoublyRobust(
	events: DecisionEventV1[],
	targetPolicy: TargetPolicyEvaluator,
): OpeResult {
	return evaluatePolicySwitch(events, targetPolicy, Infinity);
}
