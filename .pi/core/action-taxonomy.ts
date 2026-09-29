/**
 * action-taxonomy — 17-action pedagogical space and cognitive load eligibility gating.
 *
 * Grounded in:
 * - Cognitive Load Theory & Expertise Reversal (Sweller, 2006 DOI: 10.1016/j.learninstruc.2006.02.005)
 * - Example Fading & Self-Explanation (Atkinson et al., 2003 DOI: 10.1037/0022-0663.95.4.774; Renkl et al., 2002)
 * - Testing Effect & Generation Hierarchy (Roediger & Karpicke, 2006 DOI: 10.1111/j.1467-9280.2006.01693.x; Moreira et al., 2019)
 * - Refutation Text Meta-Analysis (Schroeder & Kucera, 2022 DOI: 10.1007/s10648-021-09656-z)
 * - Interleaved Category Discrimination (Taylor & Rohrer, 2010 DOI: 10.1002/acp.1598)
 * - Spacing Ridgelines & Point Processes (Cepeda et al., 2008 DOI: 10.1111/j.1467-9280.2008.02209.x; Tabibian et al., 2019)
 * - Metacognitive Hint Scaffolding (Roll et al., 2006 CMU ITS)
 * - Deadline Compression & Buffer Bounds (research/cramming.md:20–60; outputs/adaptive-learning-next-action.md Section 3)
 */

import type { LearnerDimension, SkillLearnerState } from "./learning-events.ts";

export type ActionQuadrant = "instruction" | "retrieval" | "application" | "repair";

export type PedagogicalActionType =
	| "DIRECT_INSTRUCTION"
	| "CONCISE_EXPLANATION"
	| "WORKED_EXAMPLE"
	| "EXAMPLE_PROBLEM_ALTERNATION"
	| "FREE_RECALL"
	| "CUED_RETRIEVAL"
	| "RECOGNITION"
	| "PRACTICE_PROBLEM"
	| "NEAR_TRANSFER"
	| "FAR_TRANSFER"
	| "TIERED_HINT"
	| "SCAFFOLDED_PROBLEM"
	| "FADED_SCAFFOLDING"
	| "MISCONCEPTION_REFUTATION"
	| "DISCRIMINATION_PRACTICE"
	| "SPACED_REVIEW"
	| "ASSESSMENT_SIMULATION"
	| "STOP_AND_PREPARE";

export interface PedagogicalActionMeta {
	type: PedagogicalActionType;
	quadrant: ActionQuadrant;
	label: string;
	defaultDurationMin: number;
	targetDimensions: LearnerDimension[];
	requiredResponseFormat: string;
	hintPolicy: "none" | "tiered" | "solution-reveal";
	researchReference: string;
	description: string;
}

export const ACTION_METAS = {
	DIRECT_INSTRUCTION: {
		type: "DIRECT_INSTRUCTION",
		quadrant: "instruction",
		label: "Direct Instruction",
		defaultDurationMin: 6,
		targetDimensions: ["structuralUnderstanding", "memoryAccessibility"],
		requiredResponseFormat: "concept-restatement",
		hintPolicy: "none",
		researchReference: "Sweller (2006) Cognitive Load Theory; schema construction for zero-production novices.",
		description: "Structured exposition introducing core schema, terminology, and axioms.",
	},
	CONCISE_EXPLANATION: {
		type: "CONCISE_EXPLANATION",
		quadrant: "instruction",
		label: "Concise Explanation",
		defaultDurationMin: 3,
		targetDimensions: ["structuralUnderstanding"],
		requiredResponseFormat: "causal-explanation",
		hintPolicy: "none",
		researchReference: "research/learning.md:78-102; targeted boundary repair without working memory overload.",
		description: "Targeted clarification focusing on a single logical invariant or boundary condition.",
	},
	WORKED_EXAMPLE: {
		type: "WORKED_EXAMPLE",
		quadrant: "instruction",
		label: "Worked Example",
		defaultDurationMin: 5,
		targetDimensions: ["structuralUnderstanding", "application"],
		requiredResponseFormat: "step-self-explanation",
		hintPolicy: "solution-reveal",
		researchReference: "Sweller (2006) Learning & Instruction; Atkinson et al. (2003) J. Educ. Psychol.",
		description: "Fully solved, expert-narrated problem step sequence with cognitive rationale.",
	},
	EXAMPLE_PROBLEM_ALTERNATION: {
		type: "EXAMPLE_PROBLEM_ALTERNATION",
		quadrant: "instruction",
		label: "Example-Problem Alternation",
		defaultDurationMin: 7,
		targetDimensions: ["application", "proceduralFluency"],
		requiredResponseFormat: "parallel-completion",
		hintPolicy: "tiered",
		researchReference: "Renkl et al. (2002) J. Exp. Educ.; paired example and completion for emerging schemas.",
		description: "Worked example paired immediately with an isomorphic problem completion task.",
	},
	FREE_RECALL: {
		type: "FREE_RECALL",
		quadrant: "retrieval",
		label: "Free Recall (Unprompted Generation)",
		defaultDurationMin: 4,
		targetDimensions: ["memoryAccessibility", "structuralUnderstanding"],
		requiredResponseFormat: "unprompted-free-text",
		hintPolicy: "none",
		researchReference: "Roediger & Karpicke (2006) Psychol. Sci.; Moreira et al. (2019) Front. Educ.",
		description: "Unguided generation of retrieved knowledge onto a blank canvas (blurt protocol).",
	},
	CUED_RETRIEVAL: {
		type: "CUED_RETRIEVAL",
		quadrant: "retrieval",
		label: "Cued Retrieval",
		defaultDurationMin: 2,
		targetDimensions: ["memoryAccessibility"],
		requiredResponseFormat: "short-answer-cued",
		hintPolicy: "none",
		researchReference: "Moreira et al. (2019); retrieval testing when free recall pathways are fragile.",
		description: "Target recall stimulated by an explicit partial contextual or structural prompt.",
	},
	RECOGNITION: {
		type: "RECOGNITION",
		quadrant: "retrieval",
		label: "Recognition Practice",
		defaultDurationMin: 1.5,
		targetDimensions: ["memoryAccessibility"],
		requiredResponseFormat: "multiple-choice",
		hintPolicy: "none",
		researchReference: "Soderstrom & Bjork (2015); diagnostic boundary probe, barred as terminal mastery proof.",
		description: "Multiple-choice discrimination among structured alternatives (diagnostic boundary probing).",
	},
	PRACTICE_PROBLEM: {
		type: "PRACTICE_PROBLEM",
		quadrant: "application",
		label: "Standard Practice Problem",
		defaultDurationMin: 4,
		targetDimensions: ["application", "proceduralFluency"],
		requiredResponseFormat: "independent-execution",
		hintPolicy: "tiered",
		researchReference: "research/learning.md:104-142; deliberate practice for procedural compilation.",
		description: "Independent execution of procedure within familiar context to build fluency.",
	},
	NEAR_TRANSFER: {
		type: "NEAR_TRANSFER",
		quadrant: "application",
		label: "Near-Transfer Problem",
		defaultDurationMin: 5,
		targetDimensions: ["transfer", "application"],
		requiredResponseFormat: "altered-surface-problem",
		hintPolicy: "tiered",
		researchReference: "Atkinson et al. (2003); surface context variation to prevent shallow keyword cues.",
		description: "Problem maintaining deep structure but altering surface story and context.",
	},
	FAR_TRANSFER: {
		type: "FAR_TRANSFER",
		quadrant: "application",
		label: "Far-Transfer Scenario",
		defaultDurationMin: 8,
		targetDimensions: ["transfer", "structuralUnderstanding"],
		requiredResponseFormat: "cross-domain-scenario",
		hintPolicy: "none",
		researchReference: "research/learning.md:180-218; authentic cross-domain principle abstraction.",
		description: "Authentic cross-domain problem requiring principle abstraction from unfamiliar context.",
	},
	TIERED_HINT: {
		type: "TIERED_HINT",
		quadrant: "repair",
		label: "Tiered Hint Intervention",
		defaultDurationMin: 2,
		targetDimensions: ["scaffoldIndependence"],
		requiredResponseFormat: "stepped-continuation",
		hintPolicy: "tiered",
		researchReference: "Roll et al. (2006) ITS; graduated cognitive guidance preventing bottom-out abuse.",
		description: "Contextual cueing progressing from strategic nudge to tactical hint.",
	},
	SCAFFOLDED_PROBLEM: {
		type: "SCAFFOLDED_PROBLEM",
		quadrant: "repair",
		label: "Scaffolded Problem Decomposition",
		defaultDurationMin: 6,
		targetDimensions: ["application", "structuralUnderstanding"],
		requiredResponseFormat: "subgoal-completion",
		hintPolicy: "tiered",
		researchReference: "Sweller (2006); subgoal decomposition to keep task load within working memory capacity.",
		description: "Complex multi-step task broken into guided sub-goals to manage working memory.",
	},
	FADED_SCAFFOLDING: {
		type: "FADED_SCAFFOLDING",
		quadrant: "repair",
		label: "Faded Scaffolding",
		defaultDurationMin: 5,
		targetDimensions: ["scaffoldIndependence", "application"],
		requiredResponseFormat: "faded-step-execution",
		hintPolicy: "tiered",
		researchReference: "Renkl et al. (2002); backward fading from supported to independent execution.",
		description: "Stepwise withdrawal of guidance across successive problem steps.",
	},
	MISCONCEPTION_REFUTATION: {
		type: "MISCONCEPTION_REFUTATION",
		quadrant: "repair",
		label: "Misconception Refutation",
		defaultDurationMin: 4,
		targetDimensions: ["structuralUnderstanding", "discrimination"],
		requiredResponseFormat: "counterexample-analysis",
		hintPolicy: "none",
		researchReference: "Schroeder & Kucera (2022) Educ. Psychol. Rev. (g=0.41); explicit refutation of false models.",
		description: "Explicit naming of false intuitive model, formal refutation, and replacement.",
	},
	DISCRIMINATION_PRACTICE: {
		type: "DISCRIMINATION_PRACTICE",
		quadrant: "application",
		label: "Discrimination Practice",
		defaultDurationMin: 4,
		targetDimensions: ["discrimination", "structuralUnderstanding"],
		requiredResponseFormat: "classify-before-solve",
		hintPolicy: "none",
		researchReference: "Taylor & Rohrer (2010) Appl. Cogn. Psychol.; interleaved minimal pairs for category boundaries.",
		description: "Mixed juxtaposition of confusable problem types requiring method classification before solve.",
	},
	SPACED_REVIEW: {
		type: "SPACED_REVIEW",
		quadrant: "retrieval",
		label: "Spaced Review",
		defaultDurationMin: 3,
		targetDimensions: ["memoryAccessibility"],
		requiredResponseFormat: "delayed-retrieval",
		hintPolicy: "none",
		researchReference: "Cepeda et al. (2008); Tabibian et al. (2019) PNAS; review scheduled at desirable difficulty.",
		description: "Timed retrieval scheduled near the threshold of desirable difficulty to boost stability.",
	},
	ASSESSMENT_SIMULATION: {
		type: "ASSESSMENT_SIMULATION",
		quadrant: "repair",
		label: "Assessment / Simulation",
		defaultDurationMin: 12,
		targetDimensions: ["application", "proceduralFluency", "transfer"],
		requiredResponseFormat: "closed-book-timed-exam",
		hintPolicy: "none",
		researchReference: "research/cramming.md:380-410; authentic unassisted simulation with delayed post-test scoring.",
		description: "Timed, unassisted, mixed-format evaluation matching target exam conditions.",
	},
	STOP_AND_PREPARE: {
		type: "STOP_AND_PREPARE",
		quadrant: "repair",
		label: "Stop and Prepare",
		defaultDurationMin: 0,
		targetDimensions: [],
		requiredResponseFormat: "rest-transition",
		hintPolicy: "none",
		researchReference: "research/cramming.md:465-481; mandatory pre-exam buffer protection and mental decompression.",
		description: "Halt study on reaching protected buffer; initiate mental rest and final transition.",
	},
} satisfies Record<PedagogicalActionType, PedagogicalActionMeta>;

export interface CandidateAction {
	id: string;
	actionType: PedagogicalActionType;
	kcId: string | null;
	itemTitle: string;
	estimatedDurationMin: number;
	format?: string;
	novelty?: string;
}

export interface EligibilityContext {
	state?: SkillLearnerState;
	remainingMinutes: number;
	examRequiresFarTransfer?: boolean;
	hasUnresolvedMisconception?: boolean;
	hasConfusableNeighbors?: boolean;
	isTerminalMasteryGate?: boolean;
}

export function isActionEligible(
	action: PedagogicalActionType,
	context: EligibilityContext,
): { eligible: boolean; reason?: string } {
	const state = context.state;
	const remaining = context.remainingMinutes;

	// Global buffer halt: research/cramming.md:465-481
	if (remaining <= 0) {
		return action === "STOP_AND_PREPARE"
			? { eligible: true }
			: { eligible: false, reason: "Protected exam buffer reached: focused study terminated" };
	}
	if (action === "STOP_AND_PREPARE") {
		return { eligible: false, reason: "Study time remains before protected buffer" };
	}

	// 1. DIRECT_INSTRUCTION: Sweller (2006) Expertise Reversal
	if (action === "DIRECT_INSTRUCTION") {
		if (state && state.memoryAccessibility.mean >= 0.7 && state.structuralUnderstanding.mean >= 0.7) {
			return { eligible: false, reason: "Expertise reversal: learner already possesses adequate foundational schema" };
		}
		return { eligible: true };
	}

	// 2. WORKED_EXAMPLE: Sweller (2006); Atkinson et al. (2003)
	if (action === "WORKED_EXAMPLE") {
		if (state && state.proceduralFluency.mean >= 0.75 && state.structuralUnderstanding.mean >= 0.75) {
			return { eligible: false, reason: "Expertise reversal: fluent learners benefit more from independent problem solving" };
		}
		return { eligible: true };
	}

	// 3. EXAMPLE_PROBLEM_ALTERNATION: Renkl et al. (2002)
	if (action === "EXAMPLE_PROBLEM_ALTERNATION") {
		if (state && state.proceduralFluency.mean >= 0.8) {
			return { eligible: false, reason: "Learner is ready for standard independent practice without alternating examples" };
		}
		return { eligible: true };
	}

	// 4. FREE_RECALL: Roediger & Karpicke (2006); Moreira et al. (2019)
	if (action === "FREE_RECALL") {
		if (!state || state.memoryAccessibility.evidenceCount === 0 || state.memoryAccessibility.mean < 0.25 || state.lifecycleState === "unseen") {
			return { eligible: false, reason: "Free recall unguided generation requires prior schema introduction to prevent confusion" };
		}
		return { eligible: true };
	}

	// 5. RECOGNITION: Soderstrom & Bjork (2015); Moreira et al. (2019)
	if (action === "RECOGNITION") {
		if (context.isTerminalMasteryGate) {
			return { eligible: false, reason: "Recognition testing is prohibited as terminal mastery evidence" };
		}
		return { eligible: true };
	}

	// 6. PRACTICE_PROBLEM: Schroeder & Kucera (2022); research/learning.md:104-142
	if (action === "PRACTICE_PROBLEM") {
		if (context.hasUnresolvedMisconception) {
			return { eligible: false, reason: "Standard practice is suspended until active misconception refutation is complete" };
		}
		if (state && state.structuralUnderstanding.mean < 0.25 && state.memoryAccessibility.mean < 0.25) {
			return { eligible: false, reason: "Learner lacks initial schema; worked example or alternation required first" };
		}
		return { eligible: true };
	}

	// 7. FAR_TRANSFER: research/cramming.md:20-60; Atkinson et al. (2003)
	if (action === "FAR_TRANSFER") {
		if (remaining <= 30 && !context.examRequiresFarTransfer) {
			return { eligible: false, reason: "Far transfer is prohibited in compressed cramming unless required by exam blueprint" };
		}
		if (state && state.transfer.mean < 0.3 && state.application.mean < 0.4) {
			return { eligible: false, reason: "Far transfer requires established near transfer or solid application competence" };
		}
		return { eligible: true };
	}

	// 8. FADED_SCAFFOLDING: Renkl et al. (2002); Atkinson et al. (2003)
	if (action === "FADED_SCAFFOLDING") {
		if (state && (state.assistanceState ?? 0) <= 0.05 && state.scaffoldIndependence.mean >= 0.85) {
			return { eligible: false, reason: "Learner already operates independently without scaffolding" };
		}
		return { eligible: true };
	}

	// 9. MISCONCEPTION_REFUTATION: Schroeder & Kucera (2022)
	if (action === "MISCONCEPTION_REFUTATION") {
		if (!context.hasUnresolvedMisconception && (!state || state.activeMisconceptionIds.length === 0)) {
			return { eligible: false, reason: "No active misconception identified for refutation" };
		}
		return { eligible: true };
	}

	// 10. DISCRIMINATION_PRACTICE: Taylor & Rohrer (2010)
	if (action === "DISCRIMINATION_PRACTICE") {
		if (!context.hasConfusableNeighbors) {
			return { eligible: false, reason: "No confusable neighbor relations identified in domain graph" };
		}
		return { eligible: true };
	}

	return { eligible: true };
}

/**
 * Returns a comprehensive eligibility audit report across all 18 actions for a given context.
 */
export function getActionEligibilityReport(context: EligibilityContext): Array<{
	actionType: PedagogicalActionType;
	meta: PedagogicalActionMeta;
	eligible: boolean;
	reason?: string;
}> {
	return (Object.keys(ACTION_METAS) as PedagogicalActionType[]).map((actionType) => {
		const check = isActionEligible(actionType, context);
		return {
			actionType,
			meta: ACTION_METAS[actionType],
			eligible: check.eligible,
			reason: check.reason,
		};
	});
}
