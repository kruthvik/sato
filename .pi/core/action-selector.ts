/**
 * action-selector — central rate-of-gain next-action optimizer.
 *
 * Implements the receding-horizon utility optimization:
 *   U*(a) = Net Marginal Exam Gain / (Duration(a) + tau_switch)
 * Enforces hard pedagogical gates, prerequisite traversal, and pre-exam buffer halts.
 * Reference: outputs/adaptive-learning-next-action.md Section 1.2, 6.1.
 */

import {
	ACTION_METAS,
	isActionEligible,
	type CandidateAction,
	type PedagogicalActionType,
} from "./action-taxonomy.ts";
import {
	getConfusableNeighbors,
	getDownstreamBlueprintWeight,
	getTransferTargets,
	isPrerequisiteSatisfied,
	type DomainGraph,
} from "./domain-graph.ts";
import { retrievability } from "./fsrs.ts";
import {
	determineHorizonRegime,
	getHorizonConfig,
	type HorizonRegime,
	type MemoryController,
} from "./memory-controller.ts";
import type { SkillLearnerState, TopicLearnerState } from "./learning-events.ts";

export interface BlueprintKC {
	id: string;
	weight: number;
	targetReadiness?: number;
	requiredNovelty?: string;
}

export interface ExamBlueprint {
	topic: string;
	targetDeadline?: string | null;
	/** Active study time still available, independent of wall-clock time until a deadline. */
	sessionMinutesRemaining?: number;
	protectedBufferMinutes: number;
	requiredFormat?: string;
	masteryThreshold: number;
	kcs: BlueprintKC[];
	requiresFarTransfer?: boolean;
}

export interface UtilityHyperparameters {
	lambdaP: number; // Prerequisite unlock
	lambdaT: number; // Transfer potential
	lambdaI: number; // Value of information
	lambdaK: number; // Blueprint coverage deficit
	lambdaE: number; // Error risk
	lambdaX: number; // Interference risk
	lambdaF: number; // Fatigue cost
	lambdaU: number; // Uncertainty penalty
	tauSwitch: number; // Context switching penalty (minutes)
	explorationRate: number; // Base epsilon
}

export const DEFAULT_HYPERPARAMETERS: UtilityHyperparameters = {
	lambdaP: 0.35,
	lambdaT: 0.25,
	lambdaI: 0.20,
	lambdaK: 0.30,
	lambdaE: 0.20,
	lambdaX: 0.15,
	lambdaF: 0.10,
	lambdaU: 0.15,
	tauSwitch: 0.75, // 45 seconds context switch overhead
	explorationRate: 0.10,
};

export interface ScoredAction {
	candidate: CandidateAction;
	score: number;
	rateOfGain: number;
	propensity: number;
	reasonCodes: string[];
	factors: {
		examGain: number;
		unlockValue: number;
		transferPotential: number;
		informationValue: number;
		coverageDeficit: number;
		directCosts: number;
		durationWithSwitch: number;
	};
}

export interface SelectionResult {
	action: CandidateAction;
	score: number;
	rateOfGain: number;
	propensity: number;
	reasonCodes: string[];
	allScored: ScoredAction[];
	remainingMinutes: number;
	haltedForBuffer: boolean;
	explorationActive?: boolean;
	regime?: HorizonRegime;
	sleepWarning?: string;
}

/**
 * Scales action duration dynamically by learner procedural fluency and format.
 * Reference: research/learning.md:46–63; outputs/adaptive-learning-next-action.md Section 2.1.
 */
export function estimateActionDuration(actionType: PedagogicalActionType, skill?: SkillLearnerState): number {
	const base = ACTION_METAS[actionType].defaultDurationMin;
	if (!skill) return base;
	const fluency = skill.proceduralFluency.mean;
	if (["PRACTICE_PROBLEM", "NEAR_TRANSFER", "FAR_TRANSFER", "DISCRIMINATION_PRACTICE"].includes(actionType)) {
		if (fluency >= 0.8) return Math.max(1, Math.round(base * 0.75));
		if (fluency <= 0.35) return Math.round(base * 1.35);
	}
	return base;
}

/**
 * Computes diminishing exploration budget as deadline approaches.
 * Enforces strict zero-exploration exploitation during final cramming buffers.
 * Reference: outputs/adaptive-learning-next-action.md Section 1.2, 6.1.
 */
export function computeExplorationBudget(remainingMinutes: number, baseEpsilon = 0.10): number {
	if (remainingMinutes <= 15) return 0.0;
	return baseEpsilon * Math.min(1.0, remainingMinutes / 120);
}

export function predictTargetTimePerformance(
	skillState: SkillLearnerState | undefined,
	deadlineIso?: string | null,
	now = new Date(),
): number {
	if (!skillState) return 0.05;
	const m = skillState.memoryAccessibility.mean;
	const u = skillState.structuralUnderstanding.mean;
	const a = skillState.assistanceState ?? 0;
	const stability = skillState.memoryStabilityDays ?? 1.0;

	// Elapsed time to target deadline
	let elapsedDays = 0;
	if (deadlineIso) {
		const targetTime = Date.parse(deadlineIso);
		if (!Number.isNaN(targetTime) && targetTime > now.getTime()) {
			elapsedDays = (targetTime - now.getTime()) / 86400000;
		}
	}

	// Instantaneous retrievability at deadline using unified memory math
	const rTarget = retrievability(elapsedDays, stability, "fsrs");

	// Composite readiness: availability * retrievability * understanding * (1 - support dependence)
	const readiness = m * (0.3 + 0.7 * rTarget) * (0.5 + 0.5 * u) * (1 - 0.25 * a);
	return Math.max(0.01, Math.min(1.0, readiness));
}

export function selectNextAction(
	learnerState: TopicLearnerState,
	blueprint: ExamBlueprint,
	graph: DomainGraph,
	now = new Date(),
	params = DEFAULT_HYPERPARAMETERS,
	memoryController?: MemoryController,
	rng: () => number = Math.random,
): SelectionResult {
	const deadlineMs = blueprint.targetDeadline ? Date.parse(blueprint.targetDeadline) : NaN;
	const sessionBudget = blueprint.sessionMinutesRemaining;
	let remainingMinutes = sessionBudget ?? 120; // Default 2-hour session if no time contract exists.
	if (!Number.isNaN(deadlineMs)) {
		const deadlineBudget = (deadlineMs - now.getTime()) / 60000 - blueprint.protectedBufferMinutes;
		remainingMinutes = sessionBudget === undefined ? deadlineBudget : Math.min(sessionBudget, deadlineBudget);
	}

	const regime = determineHorizonRegime(remainingMinutes);
	const horizonConfig = getHorizonConfig(regime);
	const sleepStatus = memoryController ? memoryController.isSleepProtected(blueprint.targetDeadline, now) : { protected: true };

	// 1. Hard Safety Gate: Halt and initiate transition to exam environment if buffer reached
	if (remainingMinutes <= 0) {
		const stopAction: CandidateAction = {
			id: "action-stop-buffer",
			actionType: "STOP_AND_PREPARE",
			kcId: null,
			itemTitle: "Protected Exam Buffer Halt",
			estimatedDurationMin: 0,
		};
		return {
			action: stopAction,
			score: 1.0,
			rateOfGain: 1.0,
			propensity: 1.0,
			reasonCodes: ["PROTECTED_BUFFER_REACHED", "STUDY_CEASED_FOR_EXAM_PREPARATION"],
			allScored: [],
			remainingMinutes: 0,
			haltedForBuffer: true,
			regime,
			sleepWarning: sleepStatus.warning,
		};
	}

	const blueprintWeights = Object.fromEntries(blueprint.kcs.map((kc) => [kc.id, kc.weight]));

	// 2. Identify priority targets based on blueprint gaps and uncertainty
	const targetKcPriorities = new Map<string, { priority: number; pExam: number }>();
	for (const kc of blueprint.kcs) {
		const skill = learnerState.skills[kc.id];
		const pExam = predictTargetTimePerformance(skill, blueprint.targetDeadline, now);
		const targetVal = kc.targetReadiness ?? blueprint.masteryThreshold;
		const uncertainty = skill ? skill.memoryAccessibility.uncertainty : 1.0;
		if (pExam < targetVal || uncertainty > 0.35) {
			const priority = kc.weight * (1.0 - pExam) * (0.8 + 0.4 * uncertainty);
			targetKcPriorities.set(kc.id, { priority, pExam });
		}
	}

	// If all targets are met, include any low-stability or due items
	if (targetKcPriorities.size === 0) {
		for (const kc of blueprint.kcs) {
			targetKcPriorities.set(kc.id, { priority: kc.weight * 0.2, pExam: 0.85 });
		}
	}

	// 3. Candidate Generation
	const rawCandidates: CandidateAction[] = [];
	for (const [kcId, { pExam }] of targetKcPriorities) {
		const skill = learnerState.skills[kcId];
		const hasMisconception = skill ? skill.activeMisconceptionIds.length > 0 : false;
		const confusable = getConfusableNeighbors(graph, kcId);
		const transfers = getTransferTargets(graph, kcId);

		// Misconception repair candidates
		if (hasMisconception) {
			rawCandidates.push({
				id: `cand-${kcId}-refutation`,
				actionType: "MISCONCEPTION_REFUTATION",
				kcId,
				itemTitle: `Refutation & Counter-example: ${kcId}`,
				estimatedDurationMin: estimateActionDuration("MISCONCEPTION_REFUTATION", skill),
			});
		}

		// Discrimination candidates
		if (confusable.length > 0) {
			rawCandidates.push({
				id: `cand-${kcId}-discrim`,
				actionType: "DISCRIMINATION_PRACTICE",
				kcId,
				itemTitle: `Discrimination: ${kcId} vs ${confusable.map((n) => n.label).join(", ")}`,
				estimatedDurationMin: estimateActionDuration("DISCRIMINATION_PRACTICE", skill),
			});
		}

		// Modeling / Acquisition candidates
		if (!skill || skill.lifecycleState === "unseen" || pExam < 0.3) {
			rawCandidates.push({
				id: `cand-${kcId}-direct`,
				actionType: "DIRECT_INSTRUCTION",
				kcId,
				itemTitle: `Core Schema: ${kcId}`,
				estimatedDurationMin: estimateActionDuration("DIRECT_INSTRUCTION", skill),
			});
			rawCandidates.push({
				id: `cand-${kcId}-worked`,
				actionType: "WORKED_EXAMPLE",
				kcId,
				itemTitle: `Worked Example: ${kcId}`,
				estimatedDurationMin: estimateActionDuration("WORKED_EXAMPLE", skill),
			});
		}

		// Alternation / Fading candidates
		if (skill && skill.structuralUnderstanding.mean >= 0.35 && skill.proceduralFluency.mean < 0.75) {
			rawCandidates.push({
				id: `cand-${kcId}-alternation`,
				actionType: "EXAMPLE_PROBLEM_ALTERNATION",
				kcId,
				itemTitle: `Example-Problem Alternation: ${kcId}`,
				estimatedDurationMin: estimateActionDuration("EXAMPLE_PROBLEM_ALTERNATION", skill),
			});
		}

		if (skill && (skill.assistanceState ?? 0) > 0.15) {
			rawCandidates.push({
				id: `cand-${kcId}-faded`,
				actionType: "FADED_SCAFFOLDING",
				kcId,
				itemTitle: `Faded Scaffolding Practice: ${kcId}`,
				estimatedDurationMin: estimateActionDuration("FADED_SCAFFOLDING", skill),
			});
		}

		// Retrieval / Practice candidates
		if (skill && skill.memoryAccessibility.mean >= 0.4) {
			rawCandidates.push({
				id: `cand-${kcId}-free-recall`,
				actionType: "FREE_RECALL",
				kcId,
				itemTitle: `Unprompted Recall (Blurt): ${kcId}`,
				estimatedDurationMin: estimateActionDuration("FREE_RECALL", skill),
			});
		}

		rawCandidates.push({
			id: `cand-${kcId}-cued`,
			actionType: "CUED_RETRIEVAL",
			kcId,
			itemTitle: `Cued Retrieval Probe: ${kcId}`,
			estimatedDurationMin: estimateActionDuration("CUED_RETRIEVAL", skill),
		});

		// Spaced review candidate when retrievability enters desirable difficulty window
		if (memoryController && skill && memoryController.isDueForSpacedReview(skill, now)) {
			rawCandidates.push({
				id: `cand-${kcId}-spaced-review`,
				actionType: "SPACED_REVIEW",
				kcId,
				itemTitle: `Spaced Review at Desirable Difficulty: ${kcId}`,
				estimatedDurationMin: estimateActionDuration("SPACED_REVIEW", skill),
			});
		}

		rawCandidates.push({
			id: `cand-${kcId}-practice`,
			actionType: "PRACTICE_PROBLEM",
			kcId,
			itemTitle: `Standard Practice: ${kcId}`,
			estimatedDurationMin: estimateActionDuration("PRACTICE_PROBLEM", skill),
			format: blueprint.requiredFormat,
		});

		// Transfer candidates
		rawCandidates.push({
			id: `cand-${kcId}-near-transfer`,
			actionType: "NEAR_TRANSFER",
			kcId,
			itemTitle: `Near-Transfer Variation: ${kcId}`,
			estimatedDurationMin: estimateActionDuration("NEAR_TRANSFER", skill),
		});

		if (transfers.length > 0 || blueprint.requiresFarTransfer) {
			rawCandidates.push({
				id: `cand-${kcId}-far-transfer`,
				actionType: "FAR_TRANSFER",
				kcId,
				itemTitle: `Far-Transfer Scenario: ${kcId}`,
				estimatedDurationMin: estimateActionDuration("FAR_TRANSFER", skill),
			});
		}
	}

	// Simulation candidate
	if (remainingMinutes >= 15 && targetKcPriorities.size <= 2) {
		rawCandidates.push({
			id: "cand-exam-simulation",
			actionType: "ASSESSMENT_SIMULATION",
			kcId: null,
			itemTitle: "Authentic Timed Mini-Simulation",
			estimatedDurationMin: ACTION_METAS.ASSESSMENT_SIMULATION.defaultDurationMin,
		});
	}

	// 4. Hard Eligibility Filtering
	const eligibleCandidates = rawCandidates.filter((cand) => {
		// Prune if duration exceeds remaining time
		if (cand.estimatedDurationMin > remainingMinutes) return false;

		// Prune far transfer if horizon regime does not permit it and blueprint does not require it
		if (!horizonConfig.allowsFarTransfer && !blueprint.requiresFarTransfer && cand.actionType === "FAR_TRANSFER") {
			return false;
		}

		// Enforce intervening item spacing invariant: prevent immediate re-testing of same KC
		if (memoryController && cand.kcId && !memoryController.isInterveningSpacingSatisfied(cand.kcId)) {
			if (["PRACTICE_PROBLEM", "CUED_RETRIEVAL", "FREE_RECALL"].includes(cand.actionType)) {
				return false;
			}
		}

		// If candidate is tied to a KC, verify prerequisite readiness in graph
		if (cand.kcId && ["PRACTICE_PROBLEM", "FAR_TRANSFER"].includes(cand.actionType)) {
			const { satisfied } = isPrerequisiteSatisfied(graph, cand.kcId, learnerState.skills, 0.5);
			if (!satisfied) return false;
		}

		const skill = cand.kcId ? learnerState.skills[cand.kcId] : undefined;
		const confusable = cand.kcId ? getConfusableNeighbors(graph, cand.kcId) : [];
		const hasMisconception = skill ? skill.activeMisconceptionIds.length > 0 : false;

		const check = isActionEligible(cand.actionType, {
			state: skill,
			remainingMinutes,
			examRequiresFarTransfer: blueprint.requiresFarTransfer,
			hasUnresolvedMisconception: hasMisconception,
			hasConfusableNeighbors: confusable.length > 0,
		});

		return check.eligible;
	});

	// Never bypass hard gates. If no action fits, stop and reassess rather than
	// manufacturing an ineligible retrieval probe.
	if (eligibleCandidates.length === 0) {
		const stopAction: CandidateAction = {
			id: "action-stop-no-eligible-candidate",
			actionType: "STOP_AND_PREPARE",
			kcId: null,
			itemTitle: "Pause and Reassess Learning Constraints",
			estimatedDurationMin: 0,
		};
		return {
			action: stopAction,
			score: 0,
			rateOfGain: 0,
			propensity: 1,
			reasonCodes: ["NO_ELIGIBLE_ACTION", "HARD_GATES_PRESERVED"],
			allScored: [],
			remainingMinutes,
			haltedForBuffer: false,
			explorationActive: false,
			regime,
			sleepWarning: sleepStatus.warning,
		};
	}

	// 5. Rate-of-Gain Utility Scoring
	const scoredCandidates: ScoredAction[] = eligibleCandidates.map((cand) => {
		const skill = cand.kcId ? learnerState.skills[cand.kcId] : undefined;
		const weight = cand.kcId ? blueprintWeights[cand.kcId] ?? 0.1 : 0.2;
		const pExam = cand.kcId ? predictTargetTimePerformance(skill, blueprint.targetDeadline, now) : 0.7;
		const reasonCodes: string[] = [];

		// Marginal target-time exam gain
		let baseGain = 0;
		if (["WORKED_EXAMPLE", "DIRECT_INSTRUCTION"].includes(cand.actionType)) {
			baseGain = (1 - pExam) * 0.45;
		} else if (["EXAMPLE_PROBLEM_ALTERNATION", "FADED_SCAFFOLDING"].includes(cand.actionType)) {
			baseGain = (1 - pExam) * 0.60;
		} else if (["FREE_RECALL", "CUED_RETRIEVAL", "PRACTICE_PROBLEM"].includes(cand.actionType)) {
			baseGain = (1 - pExam) * 0.70;
		} else if (cand.actionType === "MISCONCEPTION_REFUTATION") {
			baseGain = 0.85;
			reasonCodes.push("MISCONCEPTION_ACTIVE");
		} else if (cand.actionType === "DISCRIMINATION_PRACTICE") {
			baseGain = 0.75;
			reasonCodes.push("DISCRIMINATION_REQUIRED");
		} else if (cand.actionType === "ASSESSMENT_SIMULATION") {
			baseGain = 0.80;
			reasonCodes.push("SIMULATION_DUE");
		} else {
			baseGain = 0.50;
		}
		const examGain = weight * baseGain;
		if (weight >= 0.3) reasonCodes.push("HIGH_EXAM_WEIGHT");
		if (pExam < 0.4) reasonCodes.push("LOW_TARGET_TIME_RECALL");

		// Prerequisite unlock
		const unlockValue = cand.kcId ? params.lambdaP * getDownstreamBlueprintWeight(graph, cand.kcId, blueprintWeights) : 0;
		if (unlockValue > 0.15) reasonCodes.push("HIGH_DOWNSTREAM_UNLOCK");

		// Transfer potential
		let transferPotential = 0;
		if (cand.actionType === "NEAR_TRANSFER") transferPotential = params.lambdaT * 0.6;
		if (cand.actionType === "FAR_TRANSFER") transferPotential = params.lambdaT * 1.0;

		// Value of information
		const informationValue = skill ? params.lambdaI * skill.memoryAccessibility.uncertainty : params.lambdaI * 0.8;
		if (informationValue > 0.15) reasonCodes.push("HIGH_UNCERTAINTY");

		// Coverage deficit
		const coverageDeficit = skill && skill.lifecycleState === "unseen" ? params.lambdaK * weight : 0;

		// Direct costs & risks
		const errorRisk = skill && skill.operationalAbility !== undefined && skill.operationalAbility < -0.5
			? params.lambdaE * 0.5
			: 0;
		const interferenceRisk = cand.kcId && getConfusableNeighbors(graph, cand.kcId).length > 0
			? params.lambdaX * 0.3
			: 0;
		const fatigueCost = params.lambdaF * Math.max(0, 1 - remainingMinutes / 120);
		const uncertaintyPenalty = skill ? params.lambdaU * skill.memoryAccessibility.uncertainty * 0.2 : 0;
		const directCosts = errorRisk + interferenceRisk + fatigueCost + uncertaintyPenalty;

		// Repair bonus for active misconceptions and confusions
		let repairBonus = 0;
		if (cand.actionType === "MISCONCEPTION_REFUTATION") {
			repairBonus = 0.75;
		} else if (cand.actionType === "DISCRIMINATION_PRACTICE") {
			repairBonus = 0.35;
		}

		// Net marginal gain
		const netGain = Math.max(0.01, examGain + unlockValue + transferPotential + informationValue + coverageDeficit + repairBonus - directCosts);
		const durationWithSwitch = cand.estimatedDurationMin + params.tauSwitch;
		const rateOfGain = netGain / durationWithSwitch;

		return {
			candidate: cand,
			score: netGain,
			rateOfGain,
			propensity: 0,
			reasonCodes,
			factors: {
				examGain,
				unlockValue,
				transferPotential,
				informationValue,
				coverageDeficit,
				directCosts,
				durationWithSwitch,
			},
		};
	});

	// Compute selection propensities using Softmax over rate-of-gain
	const temperature = 0.5;
	const maxRate = Math.max(...scoredCandidates.map((c) => c.rateOfGain));
	const expScores = scoredCandidates.map((c) => Math.exp((c.rateOfGain - maxRate) / temperature));
	const expSum = expScores.reduce((sum, val) => sum + val, 0);
	scoredCandidates.forEach((c, idx) => {
		c.propensity = expSum > 0 ? expScores[idx] / expSum : 1 / scoredCandidates.length;
	});

	// Sort by rate of gain descending.
	scoredCandidates.sort((a, b) => b.rateOfGain - a.rateOfGain);

	// 6. Action Commitment: exploit the argmax, with bounded Softmax exploration
	// over the top three candidates. Logged propensities must describe this actual
	// behavior policy; otherwise inverse-propensity OPE is invalid.
	const explorationBudget = computeExplorationBudget(remainingMinutes, params.explorationRate);
	const explorationPool = scoredCandidates.slice(0, Math.min(3, scoredCandidates.length));
	const poolSoftmaxTotal = explorationPool.reduce((sum, candidate) => sum + candidate.propensity, 0);
	const explorationProbabilities = explorationPool.map((candidate) =>
		poolSoftmaxTotal > 0 ? candidate.propensity / poolSoftmaxTotal : 1 / explorationPool.length,
	);
	for (let index = 0; index < scoredCandidates.length; index++) {
		const poolIndex = explorationPool.indexOf(scoredCandidates[index]);
		const exploreProbability = poolIndex >= 0 ? explorationProbabilities[poolIndex] : 0;
		scoredCandidates[index].propensity = (index === 0 ? 1 - explorationBudget : 0) + explorationBudget * exploreProbability;
	}

	let chosen = scoredCandidates[0];
	let explorationActive = false;
	if (explorationBudget > 0 && explorationPool.length > 1 && rng() < explorationBudget) {
		let draw = Math.max(0, Math.min(1 - Number.EPSILON, rng()));
		for (let index = 0; index < explorationPool.length; index++) {
			draw -= explorationProbabilities[index];
			if (draw <= 0 || index === explorationPool.length - 1) {
				chosen = explorationPool[index];
				break;
			}
		}
		explorationActive = chosen !== scoredCandidates[0];
		if (explorationActive && !chosen.reasonCodes.includes("BOUNDED_EXPLORATION_ACTIVE")) {
			chosen.reasonCodes.push("BOUNDED_EXPLORATION_ACTIVE");
		}
	}

	if (!sleepStatus.protected && sleepStatus.warning && !chosen.reasonCodes.includes("SLEEP_PROTECTION_ALERT")) {
		chosen.reasonCodes.push("SLEEP_PROTECTION_ALERT");
	}

	return {
		action: chosen.candidate,
		score: chosen.score,
		rateOfGain: chosen.rateOfGain,
		propensity: chosen.propensity,
		reasonCodes: chosen.reasonCodes,
		allScored: scoredCandidates,
		remainingMinutes,
		haltedForBuffer: false,
		explorationActive,
		regime,
		sleepWarning: sleepStatus.warning,
	};
}
