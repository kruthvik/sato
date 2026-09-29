import * as crypto from "node:crypto";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	Text,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ────────────────────────────────────────────────────────────────────────────
// quiz — a GRADED sibling of ask_user_question.
//
// Where ask_user_question collects a preference/decision with no notion of
// right or wrong, `quiz` poses a question that HAS a correct answer, grades the
// user's response instantly, and shows tight feedback (✓/✗ + the correct
// answer + an optional explanation) to both the user and the agent.
//
// Supports two primary modes:
// 1. Short-Answer / Production (DEFAULT when `options` is omitted): The user
//    types their answer into an interactive text box (e.g. "estoy", "mitochondria").
//    Graded against `correctAnswer` and optional `acceptedAnswers`.
// 2. Multiple-Choice / Multi-Select (when `options` is provided): The user
//    selects from 2+ options, plus an automatic "I don't know" choice.
// ────────────────────────────────────────────────────────────────────────────

interface QuizOption {
	label: string;
	value: string;
	description?: string;
}

interface DisplayOption extends QuizOption {
	id: string;
	index: number;
	isSubmit?: boolean;
}

interface OptionAnswer {
	label: string;
	value: string;
	index: number; // 1-based, matches the number shown to the user
}

// The always-present "I don't know" choice. It is NOT a real option: it never
// participates in shuffling, has no correct-answer value, and produces a
// distinct signal (dontKnow) rather than a right/wrong grade — so an honest
// "I don't know" is never confused with a lucky or unlucky guess.
const DONT_KNOW_VALUE = "__dont_know__";
const DONT_KNOW_LABEL = "I don't know";
const DONT_KNOW_INDEX = 0; // real options are 1-based; submit uses -1

// Unified response from either ask* component. answers holds the real
// selections (empty when dontKnow); note is the optional free-text the user
// typed in the always-present note field (kept only when non-empty).
interface QuizResponse {
	dontKnow: boolean;
	note?: string;
	answers: OptionAnswer[];
}

interface ShortAnswerResponse {
	userAnswer: string;
	dontKnow: boolean;
	correct: boolean;
}

type QuizStatus = "answered" | "cancelled" | "unavailable";
type QuizMode = "single-select" | "multi-select" | "short-answer";

interface DisplayedOption {
	index: number; // 1-based, in the final (possibly shuffled) display order
	label: string;
}

interface QuizResultDetails {
	status: QuizStatus;
	question: string;
	context?: string;
	mode: QuizMode;
	answers: OptionAnswer[];
	correctIndices: number[];
	userAnswer?: string;
	correctAnswer?: string | string[];
	acceptedAnswers?: string[];
	options?: DisplayedOption[]; // full option list in display order, for the transcript
	correct?: boolean;
	dontKnow?: boolean; // user selected "I don't know" instead of guessing
	note?: string; // optional free-text from the always-present note field (any answer)
	explanation?: string;
	message?: string;
	startedAt?: string;
	submittedAt?: string;
	latencyMs?: number;
	confidenceBefore?: number;
	assessmentContext?: Record<string, unknown>;
}

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the answer option." }),
	value: Type.Optional(
		Type.String({ description: "Optional machine-readable value returned for the option. Defaults to the label." }),
	),
	description: Type.Optional(Type.String({ description: "Optional extra detail shown below the option." })),
});

const QuizParams = Type.Object({
	question: Type.String({
		description: "The single quiz question to ask. Ask exactly one question per tool call.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
	),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description:
				"Optional for short-answer questions. The answer options (2 or more) for multiple-choice or multi-select. If omitted, quiz runs in short-answer mode where the user must type the answer without multiple-choice options.",
		}),
	),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Set to true when more than one option is correct and the user must select all of them (only applies when options are provided)." }),
	),
	correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())], {
		description:
			'REQUIRED. The correct answer. For short-answer questions (no options): the target answer string (e.g. "estoy", "mitochondria"). For multiple-choice: the option value(s) of the correct choice(s).',
	}),
	acceptedAnswers: Type.Optional(
		Type.Array(Type.String(), {
			description:
				'Optional accepted answer variations/synonyms for short-answer questions (e.g. ["hyper-polarization", "hyper polarization"]).',
		}),
	),
	caseSensitive: Type.Optional(
		Type.Boolean({
			description:
				"Defaults to false. If true, short-answer comparison requires exact character casing.",
		}),
	),
	explanation: Type.String({
		description:
			"REQUIRED. Explanation revealed AFTER the user answers (shown whether they got it right or wrong). Use it to reinforce why the correct answer is correct.",
	}),
	shuffle: Type.Optional(
		Type.Boolean({
			description:
				"Defaults to true: options are randomly reordered before display so the correct answer isn't always in the same position. Set to false only when option order is meaningful (only applies to multiple-choice).",
		}),
	),
	confidenceBefore: Type.Optional(Type.Number({ description: "Predicted probability of a correct answer, captured before feedback", minimum: 0, maximum: 1 })),
	assessmentContext: Type.Optional(Type.Object({
		attemptId: Type.String(), topicId: Type.String(), skillIds: Type.Array(Type.String(), { minItems: 1 }),
		knowledgeObjectIds: Type.Array(Type.String(), { minItems: 1 }),
		mode: Type.Union([Type.Literal("teach"), Type.Literal("fast-learn"), Type.Literal("cram"), Type.Literal("project"), Type.Literal("assessment"), Type.Literal("maintenance"), Type.Literal("exam-drill")]),
		phase: Type.Union([Type.Literal("diagnostic"), Type.Literal("instruction"), Type.Literal("practice"), Type.Literal("assessment"), Type.Literal("review"), Type.Literal("external")]),
		taskType: Type.Union([Type.Literal("exposure"), Type.Literal("recognition"), Type.Literal("cued-recall"), Type.Literal("free-recall"), Type.Literal("self-explanation"), Type.Literal("discrimination"), Type.Literal("prediction"), Type.Literal("procedure"), Type.Literal("representation-conversion"), Type.Literal("analogy"), Type.Literal("error-diagnosis"), Type.Literal("near-transfer"), Type.Literal("far-transfer"), Type.Literal("simulation"), Type.Literal("authentic-performance")]),
		representation: Type.Union([Type.Literal("verbal"), Type.Literal("symbolic"), Type.Literal("graphical"), Type.Literal("spatial"), Type.Literal("procedural"), Type.Literal("mixed")]),
		novelty: Type.Union([Type.Literal("repeated"), Type.Literal("isomorphic"), Type.Literal("near-transfer"), Type.Literal("far-transfer"), Type.Literal("authentic")]),
		itemFamilyId: Type.Optional(Type.String()), parallelFormId: Type.Optional(Type.String()),
	}, { description: "Immutable metadata binding this exact attempt to learner-state evidence" })),
});

function normalizeOptions(
	options: Array<{ label: string; value?: string; description?: string }> | undefined,
): QuizOption[] {
	const seen = new Set<string>();
	return (options || [])
		.map((option) => ({
			label: option.label.trim(),
			value: option.value?.trim() || option.label.trim(),
			description: option.description?.trim() || undefined,
		}))
		.filter((option) => {
			if (option.label.length === 0) return false;
			if (seen.has(option.value)) throw new Error(`duplicate option value "${option.value}"`);
			seen.add(option.value);
			return true;
		});
}

// Fisher-Yates shuffle over a copy. Safe to reorder for display because
// correctAnswer is keyed by value, not position — indices are resolved AFTER
// shuffling, so grading always matches what the user actually sees.
function shuffleOptions(options: QuizOption[]): QuizOption[] {
	const out = [...options];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

// Resolve author-supplied option value(s) to 1-based indices. Keying by value
// (not position) makes the correct answer self-documenting: the author writes
// `correctAnswer: "mercury"` and a typo becomes a hard error instead of a
// silent wrong grade.
// The harness sometimes delivers a multi-select `correctAnswer` array as a
// JSON-stringified string (e.g. '["a", "b"]') instead of a real array, because
// the schema union lists String first. Detect that case and parse it back into
// an array so grading resolves against real option values. A plain single value
// is wrapped as-is.
function coerceCorrectAnswer(correctAnswer: string | string[]): string[] {
	if (Array.isArray(correctAnswer)) return correctAnswer;
	const trimmed = correctAnswer.trim();
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.map((v) => String(v));
		} catch {
			// Not valid JSON — fall through and treat as a single literal value.
		}
	}
	return [correctAnswer];
}

function resolveCorrect(
	correctAnswer: string | string[] | undefined,
	options: QuizOption[],
): { indices: number[]; error?: string } {
	if (correctAnswer === undefined) return { indices: [], error: "correctAnswer is required" };
	const arr = coerceCorrectAnswer(correctAnswer);
	if (arr.length === 0) return { indices: [], error: "correctAnswer is required" };
	const byValue = new Map(options.map((o, i) => [o.value, i + 1]));
	const indices: number[] = [];
	for (const raw of arr) {
		const v = typeof raw === "string" ? raw.trim() : raw;
		const idx = byValue.get(v);
		if (idx === undefined) {
			const known = options.map((o) => `"${o.value}"`).join(", ");
			return { indices: [], error: `correctAnswer "${v}" does not match any option value (${known})` };
		}
		indices.push(idx);
	}
	return { indices: Array.from(new Set(indices)).sort((a, b) => a - b) };
}

function createEditorTheme(theme: any): EditorTheme {
	return {
		borderColor: (s) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		},
	};
}

function addWrapped(lines: string[], text: string, width: number, indent = ""): void {
	const contentWidth = Math.max(1, width - indent.length);
	for (const line of wrapTextWithAnsi(text, contentWidth)) {
		lines.push(truncateToWidth(`${indent}${line}`, width));
	}
}

function isCorrect(selectedIndices: number[], correctIndices: number[]): boolean {
	if (selectedIndices.length !== correctIndices.length) return false;
	const a = [...selectedIndices].sort((x, y) => x - y);
	const b = [...correctIndices].sort((x, y) => x - y);
	return a.every((v, i) => v === b[i]);
}

function buildStructuredResult(
	status: QuizStatus,
	question: string,
	mode: QuizMode,
	answers: OptionAnswer[],
	correctIndices: number[],
	correct: boolean | undefined,
	explanation: string | undefined,
	context?: string,
	message?: string,
	options?: DisplayedOption[],
	dontKnow?: boolean,
	note?: string,
): QuizResultDetails {
	return { status, question, context, mode, answers, correctIndices, options, correct, dontKnow, note, explanation, message };
}

function cancelledResult(question: string, mode: QuizMode, correctIndices: number[], context?: string) {
	const message = "User cancelled the quiz";
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult("cancelled", question, mode, [], correctIndices, undefined, undefined, context, message),
	};
}

function unavailableResult(question: string, mode: QuizMode, message: string, correctIndices: number[], context?: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult("unavailable", question, mode, [], correctIndices, undefined, undefined, context, message),
	};
}

function formatOptionRef(options: QuizOption[], index: number): string {
	const opt = options.find((o, i) => i + 1 === index);
	return `${index}. ${opt ? opt.label : "(unknown)"}`;
}

function buildResult(
	question: string,
	context: string | undefined,
	mode: QuizMode,
	options: QuizOption[],
	response: QuizResponse,
	correctIndices: number[],
	explanation: string | undefined,
) {
	const { dontKnow, note, answers } = response;
	const selectedIndices = answers.map((a) => a.index);
	// "I don't know" is never counted as correct — it's a distinct outcome.
	const correct = dontKnow ? false : isCorrect(selectedIndices, correctIndices);
	const correctStr = correctIndices.map((i) => formatOptionRef(options, i)).join(", ");
	const displayedOptions: DisplayedOption[] = options.map((o, i) => ({ index: i + 1, label: o.label }));

	let text: string;
	if (dontKnow) {
		// Make the signal explicit for the agent: the user did NOT guess, so this
		// is a genuine knowledge gap, not a wrong answer to correct against.
		text = `User selected "I don't know" — they did not attempt an answer (a genuine knowledge gap, not a wrong guess).`;
		text += `\nCorrect: ${correctStr}`;
		if (note) text += `\nUser's note: ${note}`;
	} else {
		const verdict = correct ? "correctly" : "incorrectly";
		const selectedStr = answers.map((a) => `${a.index}. ${a.label}`).join(", ");
		text = `User answered ${verdict}.\nSelected: ${selectedStr}\nCorrect: ${correctStr}`;
		if (note) text += `\nUser's note: ${note}`;
	}
	if (explanation) text += `\nExplanation: ${explanation}`;

	return {
		content: [{ type: "text" as const, text }],
		details: buildStructuredResult(
			"answered",
			question,
			mode,
			answers,
			correctIndices,
			correct,
			explanation,
			context,
			undefined,
			displayedOptions,
			dontKnow,
			note,
		),
	};
}

function normalizeAnswerString(s: string, caseSensitive = false): string {
	let res = s.trim();
	if (!caseSensitive) {
		res = res.toLowerCase();
	}
	res = res.replace(/\s+/g, " ");
	// Strip trailing terminal punctuation (. , ! ?)
	res = res.replace(/[.,!?]+$/, "");
	return res;
}

function checkShortAnswer(
	userAnswer: string,
	correctAnswer: string | string[],
	acceptedAnswers?: string[],
	caseSensitive = false,
): boolean {
	const userNorm = normalizeAnswerString(userAnswer, caseSensitive);
	if (!userNorm) return false;

	const targets: string[] = [];
	if (Array.isArray(correctAnswer)) {
		targets.push(...correctAnswer);
	} else {
		targets.push(correctAnswer);
	}
	if (acceptedAnswers) {
		targets.push(...acceptedAnswers);
	}

	for (const t of targets) {
		if (normalizeAnswerString(t, caseSensitive) === userNorm) {
			return true;
		}
	}
	return false;
}

function buildShortAnswerResult(
	question: string,
	context: string | undefined,
	userAnswer: string,
	correctAnswer: string | string[],
	acceptedAnswers: string[] | undefined,
	dontKnow: boolean,
	correct: boolean,
	explanation: string | undefined,
) {
	const correctDisplay = Array.isArray(correctAnswer) ? correctAnswer.join(" / ") : correctAnswer;
	let text: string;
	if (dontKnow) {
		text = `User selected "I don't know" — they did not attempt an answer (a genuine knowledge gap, not a wrong guess).\nCorrect answer: ${correctDisplay}`;
	} else {
		const verdict = correct ? "correctly" : "incorrectly";
		text = `User answered ${verdict}.\nUser's answer: "${userAnswer}"\nCorrect answer: "${correctDisplay}"`;
		if (acceptedAnswers && acceptedAnswers.length > 0) {
			text += `\nAccepted variations: ${acceptedAnswers.join(", ")}`;
		}
	}
	if (explanation) {
		text += `\nExplanation: ${explanation}`;
	}

	return {
		content: [{ type: "text" as const, text }],
		details: {
			status: "answered" as const,
			question,
			context,
			mode: "short-answer" as const,
			userAnswer,
			correctAnswer,
			acceptedAnswers,
			answers: [],
			correctIndices: [],
			correct,
			dontKnow,
			explanation,
		},
	};
}

function renderShortAnswerFeedback(
	lines: string[],
	theme: any,
	width: number,
	userAnswer: string,
	correctAnswer: string | string[],
	acceptedAnswers: string[] | undefined,
	explanation: string | undefined,
	dontKnow = false,
	isMatch = false,
): void {
	const add = (text: string) => lines.push(truncateToWidth(text, width));
	lines.push("");

	const correctDisplay = Array.isArray(correctAnswer) ? correctAnswer.join(" / ") : correctAnswer;

	if (dontKnow) {
		add(theme.fg("warning", " · You said: I don't know"));
		addWrapped(lines, theme.fg("success", `✓ Correct answer: ${correctDisplay}`), width, " ");
	} else if (isMatch) {
		add(theme.fg("success", " ✓ Correct!"));
		addWrapped(lines, theme.fg("muted", `Your answer: ${userAnswer}`), width, " ");
	} else {
		add(theme.fg("error", " ✗ Incorrect."));
		addWrapped(lines, theme.fg("error", `Your answer:    ${userAnswer}`), width, " ");
		addWrapped(lines, theme.fg("success", `Correct answer: ${correctDisplay}`), width, " ");
	}

	if (acceptedAnswers && acceptedAnswers.length > 0) {
		addWrapped(lines, theme.fg("dim", `Also accepted: ${acceptedAnswers.join(", ")}`), width, " ");
	}

	if (explanation) {
		lines.push("");
		addWrapped(lines, theme.fg("text", explanation), width, " ");
	}

	lines.push("");
	add(theme.fg("dim", " Enter/Esc to continue"));
}

// Shared feedback block, rendered after the user submits.
function renderFeedback(
	lines: string[],
	theme: any,
	width: number,
	options: QuizOption[],
	selectedIndices: number[],
	correctIndices: number[],
	explanation: string | undefined,
	dontKnow = false,
	note?: string,
): void {
	const add = (text: string) => lines.push(truncateToWidth(text, width));
	const correct = !dontKnow && isCorrect(selectedIndices, correctIndices);
	const selectedSet = new Set(selectedIndices);
	const correctSet = new Set(correctIndices);

	lines.push("");
	for (let i = 0; i < options.length; i++) {
		const index = i + 1;
		const opt = options[i];
		const isSelected = selectedSet.has(index);
		const isKey = correctSet.has(index);
		let marker: string;
		let color: string;
		if (dontKnow) {
			// No guess was made — only reveal the correct answer(s); never show ✗.
			marker = isKey ? "✓" : " ";
			color = isKey ? "success" : "dim";
		} else if (isSelected && isKey) {
			marker = "✓";
			color = "success";
		} else if (isSelected && !isKey) {
			marker = "✗";
			color = "error";
		} else if (!isSelected && isKey) {
			// correct answer the user missed
			marker = "✓";
			color = "success";
		} else {
			marker = " ";
			color = "dim";
		}
		add(theme.fg(color, ` ${marker} ${index}. ${opt.label}`));
	}

	lines.push("");
	if (dontKnow) {
		add(theme.fg("warning", " · You said: I don't know"));
		const correctStr = correctIndices.map((i) => formatOptionRef(options, i)).join(", ");
		addWrapped(lines, theme.fg("muted", `Correct answer: ${correctStr}`), width, " ");
	} else if (correct) {
		add(theme.fg("success", " ✓ Correct!"));
	} else {
		add(theme.fg("error", " ✗ Incorrect."));
		const correctStr = correctIndices.map((i) => formatOptionRef(options, i)).join(", ");
		addWrapped(lines, theme.fg("muted", `Correct answer: ${correctStr}`), width, " ");
	}
	if (note) {
		addWrapped(lines, theme.fg("muted", `Your note: ${note}`), width, " ");
	}
	if (explanation) {
		lines.push("");
		addWrapped(lines, theme.fg("text", explanation), width, " ");
	}
	lines.push("");
	add(theme.fg("dim", " Enter/Esc to continue"));
}

// Top border + question + optional context. Shared by both components.
function pushHeader(lines: string[], theme: any, width: number, question: string, context: string | undefined): void {
	lines.push(truncateToWidth(theme.fg("accent", "─".repeat(width)), width));
	addWrapped(lines, theme.fg("text", question), width, " ");
	if (context) {
		lines.push("");
		addWrapped(lines, theme.fg("muted", context), width, " ");
	}
}

// The "I don't know" row in the selection list — visually separated and dimmed
// so it reads as distinct from the real, gradable options.
function pushDontKnowRow(lines: string[], theme: any, width: number, focused: boolean): void {
	lines.push("");
	const prefix = focused ? theme.fg("accent", "> ") : "  ";
	const styled = focused ? theme.fg("accent", DONT_KNOW_LABEL) : theme.fg("dim", DONT_KNOW_LABEL);
	lines.push(truncateToWidth(`${prefix}${styled}`, width));
}

// Persistent, always-present note field rendered under the options during the
// select phase. Applies to ANY answer (including "I don't know") and is only
// surfaced to the agent when non-empty.
function pushNoteField(lines: string[], theme: any, width: number, editor: Editor, focused: boolean): void {
	lines.push("");
	const label = focused ? theme.fg("accent", "Note (optional):") : theme.fg("muted", "Note (optional):");
	addWrapped(lines, label, width, " ");
	for (const line of editor.render(width)) lines.push(line);
}

// Build the note Editor. `disableSubmit` is set because Enter must NOT submit
// here: the editor's submit path clears the buffer, which would wipe the note.
// Instead the host intercepts Enter to return focus to the options while
// keeping the text. Ctrl+J still inserts a newline (pi convention), so
// multi-line notes work.
function makeNoteEditor(tui: any, theme: any): Editor {
	const editor = new Editor(tui, createEditorTheme(theme));
	editor.focused = false;
	editor.disableSubmit = true;
	return editor;
}

async function askSingleChoice(
	ctx: any,
	question: string,
	context: string | undefined,
	options: QuizOption[],
	correctIndices: number[],
	explanation: string | undefined,
): Promise<QuizResponse | null> {
	const allOptions: DisplayOption[] = options.map((option, index) => ({
		...option,
		id: `option:${index}`,
		index: index + 1,
	}));
	const dontKnowNav = allOptions.length; // nav index of the "I don't know" row

	return ctx.ui.custom<QuizResponse | null>(
		(tui: any, theme: any, _kb: any, done: (result: QuizResponse | null) => void) => {
			let optionIndex = 0;
			let phase: "select" | "feedback" = "select";
			let focus: "options" | "note" = "options";
			let chosen: OptionAnswer | null = null;
			let dontKnow = false;
			const editor = makeNoteEditor(tui, theme);
			let cachedLines: string[] | undefined;
			let cachedWidth = -1;

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function noteText(): string | undefined {
				const t = editor.getText().trim();
				return t.length ? t : undefined;
			}

			function toOptions() {
				focus = "options";
				editor.focused = false;
				refresh();
			}

			function response(): QuizResponse {
				const note = noteText();
				return dontKnow
					? { dontKnow: true, note, answers: [] }
					: { dontKnow: false, note, answers: chosen ? [chosen] : [] };
			}

			function handleInput(data: string) {
				if (phase === "feedback") {
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
						done(response());
					}
					return;
				}

				// Tab toggles focus between the options list and the note field.
				if (matchesKey(data, Key.tab)) {
					focus = focus === "options" ? "note" : "options";
					editor.focused = focus === "note";
					refresh();
					return;
				}

				if (focus === "note") {
					// Enter and Esc both return to the options and keep the note text.
					// (Enter must be intercepted here: the editor's own submit clears
					// the buffer. Ctrl+J still reaches the editor as a newline.)
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
						toOptions();
						return;
					}
					editor.handleInput(data);
					tui.requestRender();
					return;
				}

				// focus === "options"
				if (matchesKey(data, Key.up)) {
					optionIndex = Math.max(0, optionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					optionIndex = Math.min(dontKnowNav, optionIndex + 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.enter)) {
					if (optionIndex === dontKnowNav) {
						dontKnow = true;
						chosen = null;
					} else {
						const selected = allOptions[optionIndex];
						chosen = { label: selected.label, value: selected.value, index: selected.index };
						dontKnow = false;
					}
					phase = "feedback";
					refresh();
					return;
				}
				if (matchesKey(data, Key.escape)) {
					done(null);
				}
			}

			function render(width: number): string[] {
				// The cache MUST be keyed on width: pi-tui calls requestRender() but NOT
				// invalidate() on terminal resize, so render() can be re-entered with a
				// new width. Returning stale wider lines trips the TUI width guard and
				// crashes the process.
				if (cachedLines && cachedWidth === width) return cachedLines;

				const lines: string[] = [];
				const add = (text: string) => lines.push(truncateToWidth(text, width));
				pushHeader(lines, theme, width, question, context);

				if (phase === "feedback") {
					renderFeedback(
						lines,
						theme,
						width,
						options,
						chosen ? [chosen.index] : [],
						correctIndices,
						explanation,
						dontKnow,
						noteText(),
					);
					add(theme.fg("accent", "─".repeat(width)));
					cachedLines = lines;
					cachedWidth = width;
					return lines;
				}

				lines.push("");
				for (let i = 0; i < allOptions.length; i++) {
					const option = allOptions[i];
					const selected = focus === "options" && i === optionIndex;
					const prefix = selected ? theme.fg("accent", "> ") : "  ";
					const label = `${option.index}. ${option.label}`;
					const styled = selected ? theme.fg("accent", label) : theme.fg("text", label);
					add(`${prefix}${styled}`);
					if (option.description) {
						addWrapped(lines, theme.fg("muted", option.description), width, "     ");
					}
				}

				pushDontKnowRow(lines, theme, width, focus === "options" && optionIndex === dontKnowNav);

				pushNoteField(lines, theme, width, editor, focus === "note");

				lines.push("");
				if (focus === "note") {
					add(theme.fg("dim", " Type note • Ctrl+J newline • Enter back to options • Tab options • Esc back"));
				} else {
					add(theme.fg("dim", " ↑↓ navigate • Enter answer • Tab note • Esc cancel"));
				}
				add(theme.fg("accent", "─".repeat(width)));
				// Not cached when the note is focused: the editor renders a live cursor.
				if (focus !== "note") {
					cachedLines = lines;
					cachedWidth = width;
				}
				return lines;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
					editor.invalidate();
				},
				handleInput,
			};
		},
	);
}

async function askMultiChoice(
	ctx: any,
	question: string,
	context: string | undefined,
	options: QuizOption[],
	correctIndices: number[],
	explanation: string | undefined,
): Promise<QuizResponse | null> {
	const DONT_KNOW_ID = "dont-know";
	const choiceItems: DisplayOption[] = options.map((option, index) => ({
		...option,
		id: `option:${index}`,
		index: index + 1,
	}));
	const dontKnowItem: DisplayOption = {
		id: DONT_KNOW_ID,
		label: DONT_KNOW_LABEL,
		value: DONT_KNOW_VALUE,
		index: DONT_KNOW_INDEX,
	};
	const submitItem: DisplayOption = { id: "submit", label: "Submit", value: "__submit__", index: -1, isSubmit: true };
	const allItems: DisplayOption[] = [...choiceItems, dontKnowItem, submitItem];

	return ctx.ui.custom<QuizResponse | null>(
		(tui: any, theme: any, _kb: any, done: (result: QuizResponse | null) => void) => {
			let optionIndex = 0;
			let phase: "select" | "feedback" = "select";
			let focus: "options" | "note" = "options";
			const editor = makeNoteEditor(tui, theme);
			let cachedLines: string[] | undefined;
			let cachedWidth = -1;
			const selected = new Map<string, OptionAnswer>();

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function noteText(): string | undefined {
				const t = editor.getText().trim();
				return t.length ? t : undefined;
			}

			function toOptions() {
				focus = "options";
				editor.focused = false;
				refresh();
			}

			const choseDontKnow = () => selected.has(DONT_KNOW_ID);
			const realAnswers = () =>
				sortAnswers(Array.from(selected.values()).filter((a) => a.index !== DONT_KNOW_INDEX));

			function response(): QuizResponse {
				const note = noteText();
				return choseDontKnow()
					? { dontKnow: true, note, answers: [] }
					: { dontKnow: false, note, answers: realAnswers() };
			}

			// "I don't know" is exclusive: choosing it clears real selections, and
			// choosing any real option clears "I don't know".
			function toggleOption(item: DisplayOption) {
				if (item.id === DONT_KNOW_ID) {
					if (selected.has(DONT_KNOW_ID)) {
						selected.delete(DONT_KNOW_ID);
					} else {
						selected.clear();
						selected.set(DONT_KNOW_ID, { label: item.label, value: item.value, index: item.index });
					}
				} else {
					selected.delete(DONT_KNOW_ID);
					if (selected.has(item.id)) {
						selected.delete(item.id);
					} else {
						selected.set(item.id, { label: item.label, value: item.value, index: item.index });
					}
				}
				refresh();
			}

			function submit() {
				if (selected.size === 0) return;
				phase = "feedback";
				refresh();
			}

			function handleInput(data: string) {
				if (phase === "feedback") {
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
						done(response());
					}
					return;
				}

				// Tab toggles focus between the options list and the note field.
				if (matchesKey(data, Key.tab)) {
					focus = focus === "options" ? "note" : "options";
					editor.focused = focus === "note";
					refresh();
					return;
				}

				if (focus === "note") {
					// Enter and Esc both return to the options and keep the note text.
					// (Enter must be intercepted here: the editor's own submit clears
					// the buffer. Ctrl+J still reaches the editor as a newline.)
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
						toOptions();
						return;
					}
					editor.handleInput(data);
					tui.requestRender();
					return;
				}

				// focus === "options"
				if (matchesKey(data, Key.up)) {
					optionIndex = Math.max(0, optionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					optionIndex = Math.min(allItems.length - 1, optionIndex + 1);
					refresh();
					return;
				}

				const current = allItems[optionIndex];
				if (matchesKey(data, Key.space)) {
					if (current.isSubmit) return;
					toggleOption(current);
					return;
				}

				if (matchesKey(data, Key.enter)) {
					if (current.isSubmit) {
						submit();
						return;
					}
					toggleOption(current);
					return;
				}

				if (matchesKey(data, Key.escape)) {
					done(null);
				}
			}

			function render(width: number): string[] {
				// The cache MUST be keyed on width: pi-tui calls requestRender() but NOT
				// invalidate() on terminal resize, so render() can be re-entered with a
				// new width. Returning stale wider lines trips the TUI width guard and
				// crashes the process.
				if (cachedLines && cachedWidth === width) return cachedLines;

				const lines: string[] = [];
				const add = (text: string) => lines.push(truncateToWidth(text, width));
				pushHeader(lines, theme, width, question, context);

				if (phase === "feedback") {
					renderFeedback(
						lines,
						theme,
						width,
						options,
						realAnswers().map((a) => a.index),
						correctIndices,
						explanation,
						choseDontKnow(),
						noteText(),
					);
					add(theme.fg("accent", "─".repeat(width)));
					cachedLines = lines;
					cachedWidth = width;
					return lines;
				}

				lines.push("");
				for (let i = 0; i < allItems.length; i++) {
					const item = allItems[i];
					const isFocused = focus === "options" && i === optionIndex;
					const prefix = isFocused ? theme.fg("accent", "> ") : "  ";

					if (item.isSubmit) {
						const label = selected.size > 0 ? `✓ ${item.label} (${selected.size} selected)` : `○ ${item.label}`;
						const styled = isFocused
							? theme.fg("accent", label)
							: theme.fg(selected.size > 0 ? "success" : "dim", label);
						add(`${prefix}${styled}`);
						continue;
					}

					if (item.id === DONT_KNOW_ID) {
						lines.push(""); // visual separation from the real options
						const checked = selected.has(item.id);
						const label = `${checked ? "[x]" : "[ ]"} ${item.label}`;
						const styled = isFocused ? theme.fg("accent", label) : theme.fg(checked ? "warning" : "dim", label);
						add(`${prefix}${styled}`);
						continue;
					}

					const checked = selected.has(item.id);
					const marker = checked ? "[x]" : "[ ]";
					const label = `${marker} ${item.index}. ${item.label}`;
					const styled = isFocused ? theme.fg("accent", label) : theme.fg(checked ? "success" : "text", label);
					add(`${prefix}${styled}`);
					if (item.description) {
						addWrapped(lines, theme.fg("muted", item.description), width, "     ");
					}
				}

				pushNoteField(lines, theme, width, editor, focus === "note");

				lines.push("");
				if (selected.size === 0) {
					add(theme.fg("warning", " Select at least one answer before submitting."));
				}
				if (focus === "note") {
					add(theme.fg("dim", " Type note • Ctrl+J newline • Enter back to options • Tab options • Esc back"));
				} else {
					add(theme.fg("dim", " ↑↓ navigate • Space toggle • Enter submit • Tab note • Esc cancel"));
				}
				add(theme.fg("accent", "─".repeat(width)));
				// Not cached when the note is focused: the editor renders a live cursor.
				if (focus !== "note") {
					cachedLines = lines;
					cachedWidth = width;
				}
				return lines;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
					editor.invalidate();
				},
				handleInput,
			};
		},
	);
}

async function askShortAnswer(
	ctx: any,
	question: string,
	context: string | undefined,
	correctAnswer: string | string[],
	acceptedAnswers: string[] | undefined,
	caseSensitive = false,
	explanation: string | undefined,
): Promise<ShortAnswerResponse | null> {
	return ctx.ui.custom<ShortAnswerResponse | null>(
		(tui: any, theme: any, _kb: any, done: (result: ShortAnswerResponse | null) => void) => {
			let phase: "input" | "feedback" = "input";
			let focus: "input" | "dontKnow" = "input";
			let userAnswer = "";
			let dontKnow = false;
			let isMatch = false;

			const editor = new Editor(tui, createEditorTheme(theme));
			editor.focused = true;
			editor.disableSubmit = true;

			let cachedLines: string[] | undefined;
			let cachedWidth = -1;

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function submitAnswer() {
				const raw = editor.getText().trim();
				const lower = raw.toLowerCase();
				if (focus === "dontKnow" || lower === "idk" || lower === "?" || lower === "i don't know") {
					dontKnow = true;
					userAnswer = raw;
					isMatch = false;
				} else {
					userAnswer = raw;
					dontKnow = false;
					isMatch = checkShortAnswer(userAnswer, correctAnswer, acceptedAnswers, caseSensitive);
				}
				phase = "feedback";
				refresh();
			}

			function handleInput(data: string) {
				if (phase === "feedback") {
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
						done({ userAnswer, dontKnow, correct: isMatch });
					}
					return;
				}

				// Tab toggles focus between the answer input and the "I don't know" button
				if (matchesKey(data, Key.tab)) {
					focus = focus === "input" ? "dontKnow" : "input";
					editor.focused = focus === "input";
					refresh();
					return;
				}

				if (focus === "dontKnow") {
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
						dontKnow = true;
						userAnswer = "";
						isMatch = false;
						phase = "feedback";
						refresh();
						return;
					}
					if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
						focus = "input";
						editor.focused = true;
						refresh();
						return;
					}
				}

				if (focus === "input") {
					if (matchesKey(data, Key.enter)) {
						submitAnswer();
						return;
					}
					if (matchesKey(data, Key.down)) {
						focus = "dontKnow";
						editor.focused = false;
						refresh();
						return;
					}
					editor.handleInput(data);
					tui.requestRender();
					return;
				}

				if (matchesKey(data, Key.escape)) {
					done(null);
				}
			}

			function render(width: number): string[] {
				if (cachedLines && cachedWidth === width) return cachedLines;

				const lines: string[] = [];
				const add = (text: string) => lines.push(truncateToWidth(text, width));
				pushHeader(lines, theme, width, question, context);

				if (phase === "feedback") {
					renderShortAnswerFeedback(
						lines,
						theme,
						width,
						userAnswer,
						correctAnswer,
						acceptedAnswers,
						explanation,
						dontKnow,
						isMatch,
					);
					add(theme.fg("accent", "─".repeat(width)));
					cachedLines = lines;
					cachedWidth = width;
					return lines;
				}

				lines.push("");
				add(theme.fg(focus === "input" ? "accent" : "muted", " Type your answer:"));
				for (const line of editor.render(width)) {
					lines.push(line);
				}

				lines.push("");
				const dkSelected = focus === "dontKnow";
				const dkPrefix = dkSelected ? theme.fg("accent", "> ") : "  ";
				const dkLabel = dkSelected
					? theme.fg("accent", `[ ${DONT_KNOW_LABEL} ]`)
					: theme.fg("dim", `[ ${DONT_KNOW_LABEL} ]`);
				add(`${dkPrefix}${dkLabel}`);

				lines.push("");
				if (focus === "dontKnow") {
					add(theme.fg("dim", " Enter/Space to select 'I don't know' • Tab or ↑ back to typing • Esc cancel"));
				} else {
					add(theme.fg("dim", " Enter submit • Tab 'I don't know' • Esc cancel"));
				}
				add(theme.fg("accent", "─".repeat(width)));

				if (focus !== "input") {
					cachedLines = lines;
					cachedWidth = width;
				}
				return lines;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
					editor.invalidate();
				},
				handleInput,
			};
		},
	);
}

function sortAnswers(answers: OptionAnswer[]): OptionAnswer[] {
	return [...answers].sort((a, b) => a.index - b.index);
}

// Shared UI mutex. ctx.ui.custom()/editor can only handle one active call at
// a time, so ALL pop-up-style tools (quiz, ask_user_question, ...) must
// serialize against each other, not just against themselves. We stash one
// mutex on globalThis so separate extension files can share it without
// importing each other.
const SHARED_UI_LOCK_KEY = "__piSharedUiLock";
function getSharedUiLock() {
	const g = globalThis as any;
	if (!g[SHARED_UI_LOCK_KEY]) {
		let chain: Promise<void> = Promise.resolve();
		g[SHARED_UI_LOCK_KEY] = {
			withLock<T>(fn: () => T | Promise<T>): Promise<T> {
				const prev = chain;
				let release: () => void;
				chain = new Promise<void>((r) => { release = r; });
				return prev.then(fn).finally(() => release!());
			},
		};
	}
	return g[SHARED_UI_LOCK_KEY] as { withLock<T>(fn: () => T | Promise<T>): Promise<T> };
}
const sharedUiLock = getSharedUiLock();

function withUILock<T>(fn: () => Promise<T>): Promise<T> {
	return sharedUiLock.withLock(fn);
}

function attachEvidenceMetadata(result: any, params: any, startedAt: string): any {
	const submittedAt = new Date().toISOString();
	let assessmentContext = params.assessmentContext;
	if (!assessmentContext && params.topic && params.skill) {
		const isShort = !params.options || (Array.isArray(params.options) && params.options.length === 0);
		assessmentContext = {
			attemptId: crypto.randomUUID(),
			topicId: params.topic.trim(),
			skillIds: [params.skill.trim()],
			knowledgeObjectIds: [params.skill.trim()],
			mode: params.mode || "teach",
			phase: params.phase || "practice",
			taskType: params.taskType || (isShort ? "cued-recall" : "recognition"),
			representation: params.representation || "verbal",
			novelty: params.novelty || "repeated",
			itemFamilyId: params.itemFamilyId?.trim() || undefined,
			parallelFormId: params.parallelFormId?.trim() || undefined,
		};
	}
	result.details = {
		...(result.details || {}),
		startedAt,
		submittedAt,
		latencyMs: Math.max(0, Date.parse(submittedAt) - Date.parse(startedAt)),
		confidenceBefore: params.confidenceBefore,
		assessmentContext,
	};
	return result;
}

export default function quiz(pi: ExtensionAPI) {
	pi.registerTool({
		name: "quiz",
		label: "quiz",
		description:
			"Ask the user a GRADED question with a known correct answer, then instantly grade and give feedback. Unlike ask_user_question (which collects preferences/decisions with no right answer), quiz always has a correct answer supplied by you, marks the user's answer right/wrong (✓/✗), reveals the correct answer, and shows an explanation. Supports two primary modes: (1) SHORT-ANSWER / CUED RECALL (omit `options`): User types their answer into an interactive text box (e.g. 'estoy', 'mitochondria', 'O(n log n)'). Graded against `correctAnswer` and optional `acceptedAnswers`. (2) MULTIPLE-CHOICE (supply 2+ `options`): User selects from options. Also includes an automatic 'I don't know' option so the user can honestly signal a gap without guessing.",
		promptSnippet:
			"ANTI-QUIZ-SPAMMING & ACTIVE RECALL MANDATE: Never use quiz to replace teaching. Explain the concept, provide an intuitive analogy, and demonstrate a worked example FIRST. For definitions, formulas, terminology, and language conjugations, prioritize SHORT-ANSWER questions (omit `options`) so the learner must actively generate the answer from memory. Use multiple-choice only when diagnosing specific misconceptions.",
		promptGuidelines: [
			"ANTI-QUIZ-SPAMMING: Quiz is a verification probe, NOT a lecture substitute. If the learner misses an answer, DO NOT quiz again immediately. Deconstruct the error, re-explain the concept, and provide a worked example before testing again.",
			"SHORT-ANSWER VS MULTIPLE-CHOICE: Omit `options` to test active production (short-answer/fill-in-the-blank). The user will type their answer directly. Provide `options` (2 or more) ONLY when testing discrimination between specific, confusable misconceptions.",
			"quiz is GRADED; ask_user_question is not. If the question has a correct answer, use quiz. If you just need a preference, decision, or open-ended input, use ask_user_question.",
			'correctAnswer is REQUIRED. For short-answer questions (no options): the target answer string (e.g. "estoy", "mitochondria"). For multiple-choice: the option value(s) of the correct choice(s).',
			'For short-answer questions, provide acceptedAnswers (e.g. ["hyper-polarization", "hyper polarization"]) when alternative spellings or synonyms are valid.',
			"explanation is REQUIRED — always say why the correct answer is correct.",
			"If a result comes back as dontKnow, the user honestly did not know and did NOT guess — treat it as a genuine knowledge gap to teach into, not as a wrong answer.",
			"Don't leak the answer through formatting: keep phrasing neutral and don't give away the answer in the prompt.",
		],
		parameters: QuizParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const startedAt = new Date().toISOString();
			const context = params.details?.trim() || undefined;
			const explanation = params.explanation.trim();
			const hasOptions = Array.isArray(params.options) && params.options.length > 0;
			const mode: QuizMode = !hasOptions ? "short-answer" : params.multiSelect ? "multi-select" : "single-select";

			if (mode === "short-answer") {
				if (!ctx.hasUI) {
					return unavailableResult(params.question, mode, "quiz requires interactive mode UI", [], context);
				}
				if (!params.correctAnswer) {
					return unavailableResult(params.question, mode, "quiz short-answer mode requires correctAnswer", [], context);
				}
				if (signal?.aborted) {
					return cancelledResult(params.question, mode, [], context);
				}
				onUpdate?.({
					content: [{ type: "text", text: "Awaiting user short-answer response..." }],
					details: { mode: "short-answer", question: params.question },
				});
				return withUILock(async () => {
					const response = await askShortAnswer(
						ctx,
						params.question,
						context,
						params.correctAnswer,
						params.acceptedAnswers,
						params.caseSensitive,
						explanation,
					);
					if (!response) {
						return cancelledResult(params.question, mode, [], context);
					}
					return attachEvidenceMetadata(buildShortAnswerResult(
						params.question,
						context,
						response.userAnswer,
						params.correctAnswer,
						params.acceptedAnswers,
						response.dontKnow,
						response.correct,
						explanation,
					), params, startedAt);
				});
			}

			let options: QuizOption[];
			try {
				options = normalizeOptions(params.options);
			} catch (e) {
				return unavailableResult(params.question, mode, `quiz ${(e as Error).message}`, [], context);
			}

			// Shuffle for display (default on) BEFORE resolving correct indices, so
			// grading matches the order the user sees.
			if (params.shuffle !== false) {
				options = shuffleOptions(options);
			}

			// Emit the true (post-shuffle) display order immediately, before the UI
			// blocks on the user's answer.
			onUpdate?.({
				content: [{ type: "text", text: "Awaiting user response..." }],
				details: { options: options.map((o, i) => ({ index: i + 1, label: o.label })) },
			});

			const { indices: correctIndices, error: correctError } = resolveCorrect(
				params.correctAnswer as string | string[],
				options,
			);

			if (signal?.aborted) {
				return cancelledResult(params.question, mode, correctIndices, context);
			}

			if (options.length < 2) {
				return unavailableResult(
					params.question,
					mode,
					"multiple-choice quiz requires at least two options (or omit options for short-answer mode)",
					correctIndices,
					context,
				);
			}

			if (correctError) {
				return unavailableResult(params.question, mode, `quiz ${correctError}`, correctIndices, context);
			}

			if (!ctx.hasUI) {
				return unavailableResult(params.question, mode, "quiz requires interactive mode UI", correctIndices, context);
			}

			return withUILock(async () => {
				const response =
					mode === "single-select"
						? await askSingleChoice(ctx, params.question, context, options, correctIndices, explanation)
						: await askMultiChoice(ctx, params.question, context, options, correctIndices, explanation);
				if (!response) {
					return cancelledResult(params.question, mode, correctIndices, context);
				}
				return attachEvidenceMetadata(buildResult(params.question, context, mode, options, response, correctIndices, explanation), params, startedAt);
			});
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("quiz ")) + theme.fg("muted", args.question);
			if (args.multiSelect) {
				text += theme.fg("dim", " [multi-select]");
			} else if (!args.options || (Array.isArray(args.options) && args.options.length === 0)) {
				text += theme.fg("dim", " [short-answer]");
			} else if (Array.isArray(args.options) && args.options.length > 0) {
				const noun = args.options.length === 1 ? "option" : "options";
				text += theme.fg("dim", ` (${args.options.length} ${noun})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as QuizResultDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}

			if (details.status === "cancelled") {
				return new Text(theme.fg("warning", details.message || "Cancelled"), 0, 0);
			}
			if (details.status === "unavailable") {
				return new Text(theme.fg("warning", details.message || "quiz unavailable"), 0, 0);
			}

			if (details.mode === "short-answer") {
				const lines: string[] = [];
				const correctDisplay = Array.isArray(details.correctAnswer)
					? details.correctAnswer.join(" / ")
					: (details.correctAnswer || "");
				if (details.dontKnow) {
					lines.push(theme.fg("warning", "· You said: I don't know"));
					lines.push(theme.fg("success", `✓ Correct answer: ${correctDisplay}`));
				} else if (details.correct) {
					lines.push(theme.fg("success", `✓ Correct! Your answer: ${details.userAnswer}`));
				} else {
					lines.push(theme.fg("error", `✗ Incorrect. Your answer: ${details.userAnswer}`));
					lines.push(theme.fg("success", `✓ Correct answer: ${correctDisplay}`));
				}
				if (details.acceptedAnswers && details.acceptedAnswers.length > 0) {
					lines.push(theme.fg("dim", `Also accepted: ${details.acceptedAnswers.join(", ")}`));
				}
				if (details.explanation) {
					lines.push(theme.fg("muted", details.explanation));
				}
				return new Text(lines.join("\n"), 0, 0);
			}

			const correctSet = new Set(details.correctIndices);
			const selectedSet = new Set(details.answers.map((a) => a.index));
			const lines: string[] = [];

			const displayed =
				details.options && details.options.length > 0
					? details.options
					: details.answers.map((a) => ({ index: a.index, label: a.label }));

			for (const opt of displayed) {
				const isSelected = selectedSet.has(opt.index);
				const isKey = correctSet.has(opt.index);
				let mark: string;
				let body: string;
				if (details.dontKnow) {
					mark = isKey ? theme.fg("success", "✓ ") : "  ";
					body = isKey ? theme.fg("success", `${opt.index}. ${opt.label}`) : theme.fg("dim", `${opt.index}. ${opt.label}`);
				} else if (isSelected && isKey) {
					mark = theme.fg("success", "✓ ");
					body = theme.fg("accent", `${opt.index}. ${opt.label}`);
				} else if (isSelected && !isKey) {
					mark = theme.fg("error", "✗ ");
					body = theme.fg("error", `${opt.index}. ${opt.label}`);
				} else if (!isSelected && isKey) {
					mark = theme.fg("success", "✓ ");
					body = theme.fg("success", `${opt.index}. ${opt.label}`);
				} else {
					mark = "  ";
					body = theme.fg("dim", `${opt.index}. ${opt.label}`);
				}
				lines.push(`${mark}${body}`);
			}

			lines.push("");
			const verdict = details.dontKnow
				? theme.fg("warning", "I don't know")
				: details.correct
					? theme.fg("success", "Correct!")
					: theme.fg("error", "Incorrect");
			lines.push(verdict);

			if (details.note) {
				lines.push(theme.fg("muted", `Note: ${details.note}`));
			}

			if (details.explanation) {
				lines.push(theme.fg("muted", details.explanation));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
