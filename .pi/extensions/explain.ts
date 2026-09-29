/** Collect an ungraded, open-ended learner explanation. */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const ExplanationParams = Type.Object({
	prompt: Type.String({
		description: "One open-ended prompt asking the learner to explain, predict, justify, or teach a concept.",
	}),
	criteria: Type.Optional(
		Type.Array(Type.String(), {
			description: "Optional points the explanation should address. These guide the learner but are not an answer key.",
		}),
	),
	context: Type.Optional(
		Type.String({ description: "Optional neutral context. Do not include the answer or a model explanation." }),
	),
});

type ExplanationDetails = {
	status: "answered" | "cancelled" | "unavailable";
	prompt: string;
	criteria?: string[];
	context?: string;
	response?: string;
	message?: string;
};

const SHARED_UI_LOCK_KEY = "__piSharedUiLock";
function getSharedUiLock() {
	const g = globalThis as any;
	if (!g[SHARED_UI_LOCK_KEY]) {
		let tail: Promise<void> = Promise.resolve();
		g[SHARED_UI_LOCK_KEY] = {
			async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
				const previous = tail;
				let release!: () => void;
				tail = new Promise<void>((resolve) => { release = resolve; });
				await previous;
				try { return await fn(); } finally { release(); }
			},
		};
	}
	return g[SHARED_UI_LOCK_KEY] as { withLock<T>(fn: () => T | Promise<T>): Promise<T> };
}

const sharedUiLock = getSharedUiLock();

function result(details: ExplanationDetails) {
	let text: string;
	if (details.status === "answered") text = `Learner explanation:\n${details.response}`;
	else text = details.message || `Explanation ${details.status}`;
	return { content: [{ type: "text" as const, text }], details };
}

export default function explain(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_for_explanation",
		label: "explain",
		description:
			"Collect a multiline, open-ended learner explanation without grading it by exact string match. Use for Feynman teach-backs, self-explanations, predictions, causal reasoning, and boundary/failure cases. After the response, evaluate it against the concept and record learning evidence separately.",
		promptSnippet:
			"MANDATORY FOR FEYNMAN INVERSION: Only initiate after confirming the learner has NO remaining questions on the lesson. Relay each question from the student subagent to the learner using ask_for_explanation. When the learner responds, resume the student child subagent (subagent({ action: \"resume\", runId, input })) until MENTAL_MODEL_UPDATED.",
		promptGuidelines: [
			"Use quiz for questions with a concise known answer; use ask_for_explanation for extended reasoning or teach-back.",
			"Criteria may name dimensions to cover, but must not reveal the answer.",
			"A submitted explanation is evidence to evaluate, not automatic proof of mastery.",
			"FEYNMAN RULE: Never roleplay the student yourself in chat. You must invoke the actual child subagent via subagent({ agent: 'student', task: '...', async: false }) and use ask_for_explanation strictly to relay the peer's question to the learner.",
		],
		parameters: ExplanationParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const prompt = params.prompt.trim();
			const context = params.context?.trim() || undefined;
			const criteria = params.criteria?.map((item) => item.trim()).filter(Boolean);
			if (!ctx.hasUI) {
				return result({ status: "unavailable", prompt, context, criteria, message: "ask_for_explanation requires interactive mode UI" });
			}
			if (signal?.aborted) {
				return result({ status: "cancelled", prompt, context, criteria, message: "Explanation cancelled" });
			}

			const titleParts = [prompt];
			if (context) titleParts.push(context);
			if (criteria?.length) titleParts.push(`Address: ${criteria.join("; ")}`);
			const response = await sharedUiLock.withLock(() => ctx.ui.editor(titleParts.join("\n\n"), ""));
			if (response === undefined) {
				return result({ status: "cancelled", prompt, context, criteria, message: "Learner cancelled the explanation" });
			}
			const trimmed = response.trim();
			if (!trimmed) {
				return result({ status: "cancelled", prompt, context, criteria, message: "Learner submitted an empty explanation" });
			}
			return result({ status: "answered", prompt, context, criteria, response: trimmed });
		},

		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("explain ")) + theme.fg("muted", args.prompt), 0, 0);
		},

		renderResult(toolResult, _options, theme) {
			const details = toolResult.details as ExplanationDetails | undefined;
			if (!details) return new Text("", 0, 0);
			if (details.status !== "answered") {
				return new Text(theme.fg("warning", details.message || "Explanation cancelled"), 0, 0);
			}
			return new Text(theme.fg("accent", "Learner explanation") + `\n${details.response}`, 0, 0);
		},
	});
}
