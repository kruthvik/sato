/**
 * activity-studio — compile Learning Activity Spec (LAS) payloads into a
 * private browser activity and return structured performance evidence to Pi.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as childProcess from "node:child_process";
import { marked } from "marked";
import katex from "katex";
import sanitizeHtml from "sanitize-html";
import { createLearningEvent, ingestLearningEvent, readLearningEvents, type TaskType } from "../core/learning-events.ts";
import { loadPolicy, type LearningMode } from "../core/policy.ts";
import { readSessionForContext } from "./learning-session.ts";

type ActivityMode = "diagnostic" | "practice" | "simulation";

interface ActivitySpec {
	version?: number;
	id?: string;
	title: string;
	topic: string;
	objective: string;
	mode?: ActivityMode;
	sourceMode?: LearningMode;
	passScore?: number;
	instructions?: string;
	contentHash?: string;
	appearance?: {
		preset?: "study" | "editorial" | "technical" | "midnight";
		accent?: string;
		density?: "compact" | "comfortable" | "spacious";
		radius?: "sharp" | "soft";
		layout?: "single" | "split";
		showItemTypes?: boolean;
	};
	items: any[];
}

interface ActivityResultItem {
	id: string;
	type: string;
	skill: string;
	correct: boolean | null;
	earned: number;
	points: number;
	response: unknown;
	latencyMs?: number;
	confidenceBefore?: number;
	hintsRequested?: number;
}

interface ActivityResult {
	version: 1;
	activityId: string;
	title: string;
	topic: string;
	objective: string;
	mode: ActivityMode;
	score: number;
	passed: boolean;
	earned: number;
	total: number;
	startedAt?: string;
	completedAt: string;
	contentHash?: string;
	items: ActivityResultItem[];
}

const ITEM_TYPES = new Set([
	"choice",
	"multi-select",
	"text",
	"numeric",
	"expression",
	"integral",
	"cloze",
	"match",
	"order",
	"reflection",
	"content",
	"speaking",
	"sheet",
	"accounting-sheet",
]);

const APPEARANCE_VALUES = {
	preset: new Set(["study", "editorial", "technical", "midnight"]),
	density: new Set(["compact", "comfortable", "spacious"]),
	radius: new Set(["sharp", "soft"]),
	layout: new Set(["single", "split"]),
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ITEM_TASK_TYPES = new Set(["recognition", "cued-recall", "discrimination", "procedure", "near-transfer", "far-transfer"]);
const NOVELTIES = new Set(["repeated", "isomorphic", "near-transfer", "far-transfer", "authentic"]);
const REPRESENTATIONS = new Set(["verbal", "symbolic", "graphical", "spatial", "procedural", "mixed"]);

const serverState: { server: http.Server | null; port: number; cwd: string } = {
	server: null,
	port: 38473,
	cwd: process.cwd(),
};

function activityRoot(cwd: string): string {
	return path.join(cwd, "_learning", "activities");
}

function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
}

function cleanText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function validateActivity(input: ActivitySpec): { activity?: ActivitySpec & { version: 1; id: string; mode: ActivityMode; passScore: number; instructions: string }; errors: string[] } {
	const errors: string[] = [];
	const title = cleanText(input?.title);
	const topic = cleanText(input?.topic);
	const objective = cleanText(input?.objective);
	const mode = input?.mode || "practice";
	const passScore = input?.passScore ?? 80;
	if (!title) errors.push("title is required");
	if (!topic) errors.push("topic is required");
	if (!objective) errors.push("objective is required");
	if (!["diagnostic", "practice", "simulation"].includes(mode)) errors.push("mode must be diagnostic, practice, or simulation");
	if (!Number.isInteger(passScore) || passScore < 1 || passScore > 100) errors.push("passScore must be an integer from 1 to 100");
	if (!Array.isArray(input?.items) || input.items.length === 0) errors.push("items must contain at least one activity item");
	if (Array.isArray(input?.items) && input.items.length > 50) errors.push("an activity may contain at most 50 items");
	const appearance = input?.appearance || {};
	if (appearance.preset && !APPEARANCE_VALUES.preset.has(appearance.preset)) errors.push("appearance.preset is unsupported");
	if (appearance.density && !APPEARANCE_VALUES.density.has(appearance.density)) errors.push("appearance.density is unsupported");
	if (appearance.radius && !APPEARANCE_VALUES.radius.has(appearance.radius)) errors.push("appearance.radius is unsupported");
	if (appearance.layout && !APPEARANCE_VALUES.layout.has(appearance.layout)) errors.push("appearance.layout is unsupported");
	if (appearance.accent && !HEX_COLOR.test(appearance.accent)) errors.push("appearance.accent must be a six-digit hex color");

	const ids = new Set<string>();
	for (const [index, item] of (input?.items || []).entries()) {
		const at = `items[${index}]`;
		if (!item || typeof item !== "object") {
			errors.push(`${at} must be an object`);
			continue;
		}
		if (!cleanText(item.id)) errors.push(`${at}.id is required`);
		else if (ids.has(item.id)) errors.push(`${at}.id must be unique`);
		else ids.add(item.id);
		if (!ITEM_TYPES.has(item.type)) errors.push(`${at}.type is unsupported`);
		if (!cleanText(item.prompt)) errors.push(`${at}.prompt is required`);
		if (item.type !== "content" && !cleanText(item.skill)) errors.push(`${at}.skill is required`);
		if (!Number.isFinite(item.points) || item.points < 0) errors.push(`${at}.points must be a non-negative number`);
		if (!['reflection', 'content'].includes(item.type) && item.points === 0) errors.push(`${at}.points must be greater than zero for a graded item`);
		if (!['reflection', 'content'].includes(item.type) && !cleanText(item.explanation)) errors.push(`${at}.explanation is required for feedback`);
		if (item.type === "content" && !cleanText(item.content)) errors.push(`${at}.content is required`);
		if (item.width && !["full", "half"].includes(item.width)) errors.push(`${at}.width must be full or half`);
		if (item.tone && !["default", "accent", "quiet"].includes(item.tone)) errors.push(`${at}.tone is unsupported`);
		if (item.taskType && !ITEM_TASK_TYPES.has(item.taskType)) errors.push(`${at}.taskType cannot be automatically verified; use an ungraded reflection and assess the explanation separately`);
		if (["choice", "multi-select"].includes(item.type) && item.taskType && !["recognition", "discrimination"].includes(item.taskType)) errors.push(`${at}.taskType cannot promote selection to application evidence`);
		if (item.novelty && !NOVELTIES.has(item.novelty)) errors.push(`${at}.novelty is unsupported`);
		if (item.representation && !REPRESENTATIONS.has(item.representation)) errors.push(`${at}.representation is unsupported`);

		if (item.type === "choice") {
			if (!Array.isArray(item.options) || item.options.length < 2) errors.push(`${at}.options needs at least two choices`);
			if (!cleanText(item.answer) || !item.options?.includes(item.answer)) errors.push(`${at}.answer must exactly match one option`);
		}
		if (item.type === "multi-select") {
			if (!Array.isArray(item.options) || item.options.length < 2) errors.push(`${at}.options needs at least two choices`);
			if (!Array.isArray(item.answers) || item.answers.length === 0 || item.answers.some((answer: string) => !item.options?.includes(answer))) errors.push(`${at}.answers must be non-empty exact option values`);
		}
		if (item.type === "text" && (!Array.isArray(item.acceptedAnswers) || item.acceptedAnswers.length === 0) && (!Array.isArray(item.containsAll) || item.containsAll.length === 0)) errors.push(`${at} needs acceptedAnswers or containsAll`);
		if (item.type === "numeric" && !Number.isFinite(item.answer)) errors.push(`${at}.answer must be numeric`);
		if (item.type === "expression" && !cleanText(item.answer)) errors.push(`${at}.answer is required`);
		if (item.type === "integral") {
			if (!cleanText(item.integrand)) errors.push(`${at}.integrand is required`);
			if (!/^[a-zA-Z]$/.test(item.variable || "")) errors.push(`${at}.variable must be one letter`);
			if (!cleanText(item.answer)) errors.push(`${at}.answer is required`);
		}
		if (item.type === "cloze") {
			if (!Array.isArray(item.blanks) || item.blanks.length === 0 || item.blanks.some((blank: any) => !Array.isArray(blank.answers) || blank.answers.length === 0)) errors.push(`${at}.blanks must each contain answers`);
			for (let blank = 1; blank <= (item.blanks?.length || 0); blank++) if (!item.prompt?.includes(`[[${blank}]]`)) errors.push(`${at}.prompt is missing [[${blank}]]`);
		}
		if (item.type === "match" && (!Array.isArray(item.pairs) || item.pairs.length < 2 || item.pairs.some((pair: any) => !cleanText(pair.left) || !cleanText(pair.right)))) errors.push(`${at}.pairs needs at least two complete pairs`);
		if (item.type === "order" && (!Array.isArray(item.steps) || item.steps.length < 2 || new Set(item.steps).size !== item.steps.length)) errors.push(`${at}.steps needs at least two unique values in correct order`);
		if (item.type === "speaking") {
			const expected = Array.isArray(item.acceptedPhrases) ? item.acceptedPhrases : cleanText(item.expectedPhrase) ? [item.expectedPhrase] : [];
			if (expected.length === 0) errors.push(`${at} needs expectedPhrase or acceptedPhrases`);
		}
		if (["sheet", "accounting-sheet"].includes(item.type)) {
			if (item.columns && (!Array.isArray(item.columns) || item.columns.length < 2)) {
				errors.push(`${at}.columns needs at least two column names`);
			}
		}
	}

	if (errors.length > 0) return { errors };
	const id = safeId(cleanText(input.id) || `${topic.toLowerCase().replace(/\s+/g, "-")}-${crypto.randomUUID().slice(0, 8)}`);
	return {
		errors,
		activity: {
			version: 1,
			id,
			title,
			topic,
			objective,
			mode: mode as ActivityMode,
			passScore,
			instructions: cleanText(input.instructions) || "Complete the activity without notes, then submit for feedback.",
			appearance: input.appearance,
			items: input.items,
		}, 
	};
}

export function renderRich(source: unknown): string {
	const codeBlocks: string[] = [];
	const math: string[] = [];

	let text = String(source ?? "");

	// 1. Protect code blocks and inline code from LaTeX processing
	text = text.replace(/(```[\s\S]*?```|`[^`\n]+?`)/g, (match) => {
		const token = "LASCODETOKEN" + codeBlocks.length + "END";
		codeBlocks.push(match);
		return token;
	});

	const stash = (expression: string, displayMode: boolean) => {
		const html = katex.renderToString(expression.trim(), {
			displayMode,
			throwOnError: false,
			strict: "ignore",
			trust: false,
			output: "htmlAndMathml",
		});
		const token = "LASMATHTOKEN" + math.length + "END";
		math.push(html);
		return token;
	};

	// 2. Display math blocks:
	// 2a. $$ ... $$ (supports multiline)
	text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_all, expr) => stash(expr, true));

	// 2b. \[ ... \]
	text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_all, expr) => stash(expr, true));

	// 2c. \begin{env} ... \end{env}
	const mathEnvs = "aligned|align\\*?|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|equation\\*?|gather\\*?|split|alignat\\*?";
	const envRegex = new RegExp(`\\\\begin\\{(${mathEnvs})\\}([\\s\\S]*?)\\\\end\\{\\1\\}`, "g");
	text = text.replace(envRegex, (_all) => stash(_all, true));

	// 3. Inline math:
	// 3a. \( ... \)
	text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_all, expr) => stash(expr, false));

	// 3b. $...$ (standard markdown math rules: no whitespace padding, closing delimiter not followed by digit)
	text = text.replace(/(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_all, expr) => stash(expr, false));

	// 4. Restore code tokens before markdown parsing so marked can format them
	for (let i = 0; i < codeBlocks.length; i++) {
		text = text.replace("LASCODETOKEN" + i + "END", codeBlocks[i]);
	}

	let html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
	html = html.replace(/<table>([\s\S]*?)<\/table>/g, (_match) => "<div class=\"table-wrap\">" + _match + "</div>");

	html = sanitizeHtml(html, {
		allowedTags: sanitizeHtml.defaults.allowedTags.concat([
			"img", "details", "summary", "span", "div", "colgroup", "col", "tfoot", "sub", "sup", "mark"
		]),
		allowedAttributes: {
			a: ["href", "title", "target", "rel"],
			img: ["src", "alt", "title", "width", "height"],
			code: ["class"],
			th: ["align", "colspan", "rowspan", "class", "style", "scope"],
			td: ["align", "colspan", "rowspan", "class", "style"],
			table: ["class", "style"],
			div: ["class", "style"],
			span: ["class", "style"],
			p: ["class", "style"],
			blockquote: ["class", "style"],
			details: ["open", "class"],
			summary: ["class"],
		},
		allowedStyles: {
			"*": {
				"text-align": [/^left$/, /^right$/, /^center$/, /^justify$/],
				"vertical-align": [/^top$/, /^middle$/, /^bottom$/, /^baseline$/],
				"white-space": [/^nowrap$/, /^normal$/, /^pre-wrap$/],
				"font-weight": [/^[0-9]{3}$/, /^bold$/, /^normal$/, /^semibold$/],
				"font-family": [/^monospace$/, /^var\(--[a-zA-Z0-9-]+\)$/],
			},
		},
		allowedSchemes: ["http", "https", "mailto", "data"],
		allowedSchemesByTag: { img: ["http", "https", "data"] },
		transformTags: {
			a: (_tagName, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
		},
	});
	for (let i = 0; i < math.length; i++) html = html.replaceAll("LASMATHTOKEN" + i + "END", math[i]);
	html = html.replace(/\\(\$\$|\$)/g, (_m, p1) => p1 === "$$" ? "$$" : "$");
	return html;
}


function compileRichActivity(activity: ActivitySpec): ActivitySpec & Record<string, unknown> {
	const compiled: any = structuredClone(activity);
	compiled._objectiveHtml = renderRich(activity.objective);
	compiled._instructionsHtml = renderRich(activity.instructions);
	compiled.items = activity.items.map((item: any) => ({
		...item,
		_promptHtml: renderRich(item.prompt),
		_contentHtml: item.content ? renderRich(item.content) : "",
		_displayHtml: item.display ? renderRich(`$$${item.display}$$`) : "",
		_hintHtml: item.hint ? renderRich(item.hint) : "",
		_explanationHtml: item.explanation ? renderRich(item.explanation) : "",
		_optionHtml: Array.isArray(item.options) ? item.options.map(renderRich) : [],
		_pairHtml: Array.isArray(item.pairs) ? item.pairs.map((pair: any) => ({ left: renderRich(pair.left), right: renderRich(pair.right) })) : [],
		_stepHtml: Array.isArray(item.steps) ? item.steps.map(renderRich) : [],
	}));
	return compiled;
}

function activityContentPath(cwd: string, activityId: string): string {
	return path.join(cwd, "content", "activities", `${safeId(activityId)}.md`);
}

function yamlText(value: string): string {
	return JSON.stringify(value);
}

function exportActivityToObsidian(cwd: string, activity: ActivitySpec): string {
	const contentPath = activityContentPath(cwd, activity.id!);
	fs.mkdirSync(path.dirname(contentPath), { recursive: true });
	const lines = [
		"---",
		"tags: [learning/activity]",
		`activity-id: ${yamlText(activity.id!)}`,
		`topic: ${yamlText(activity.topic)}`,
		`mode: ${activity.mode || "practice"}`,
		`objective: ${yamlText(activity.objective)}`,
		"---",
		"",
		`# ${activity.title}`,
		"",
		`> [!goal] Objective\n> ${activity.objective}`,
		"",
		activity.instructions || "Complete without notes, then submit for feedback.",
	];

	for (const [index, item] of activity.items.entries()) {
		if (item.type === "content") {
			lines.push("", item.content || item.prompt);
			continue;
		}
		lines.push("", `## ${index + 1}. ${item.prompt}`);
		if (item.display) lines.push("", `$$${item.display}$$`);
		if (Array.isArray(item.options)) {
			for (const option of item.options) lines.push(`- [ ] ${option}`);
		}
		if (item.hint) lines.push("", `> [!hint]- Hint\n> ${String(item.hint).replace(/\n/g, "\n> ")}`);
	}

	lines.push("", "> [!note] Feedback", "> Submit the browser activity before reviewing feedback. Results and explanations are added to this note after submission.", "");
	fs.writeFileSync(contentPath, lines.join("\n"), "utf-8");
	return contentPath;
}

function itemAnswer(item: any): string {
	if (item.type === "choice" || item.type === "numeric" || item.type === "expression" || item.type === "integral") return String(item.answer ?? "");
	if (item.type === "multi-select") return (item.answers || []).join(", ");
	if (item.type === "text") return (item.acceptedAnswers || item.containsAll || []).join(" / ");
	if (item.type === "cloze") return (item.blanks || []).map((blank: any) => (blank.answers || []).join(" / ")).join("; ");
	if (item.type === "match") return (item.pairs || []).map((pair: any) => `${pair.left} → ${pair.right}`).join("; ");
	if (item.type === "order") return (item.steps || []).join(" → ");
	if (item.type === "speaking") return (item.acceptedPhrases || [item.expectedPhrase]).filter(Boolean).join(" / ");
	if (item.type === "sheet" || item.type === "accounting-sheet") return "Balanced verified accounting sheet";
	return "Evaluated by the tutor";
}

function appendActivityFeedback(cwd: string, result: ActivityResult): void {
	const contentPath = activityContentPath(cwd, result.activityId);
	const specPath = path.join(activityRoot(cwd), "specs", `${safeId(result.activityId)}.json`);
	if (!fs.existsSync(contentPath) || !fs.existsSync(specPath)) return;
	let activity: ActivitySpec;
	try { activity = JSON.parse(fs.readFileSync(specPath, "utf-8")) as ActivitySpec; }
	catch { return; }
	const resultById = new Map(result.items.map((item) => [item.id, item]));
	const lines = [
		"",
		"## Submitted result",
		"",
		`- Completed: ${result.completedAt}`,
		`- Score: ${result.score}% (${result.earned}/${result.total})`,
		`- Practice target: ${result.passed ? "reached" : "not yet reached"}`,
		"",
		"> [!warning] Evidence status",
		"> This is same-session performance, not proof of durable mastery. Recheck important skills after a delay and in a changed context.",
	];
	for (const item of activity.items) {
		if (item.type === "content") continue;
		const observed = resultById.get(item.id);
		const status = observed?.correct === null ? "ungraded" : observed?.correct ? "correct" : "needs repair";
		lines.push("", `### ${item.prompt}`, "", `- Status: ${status}`, `- Expected: ${itemAnswer(item)}`);
		if (item.explanation) lines.push(`- Feedback: ${item.explanation}`);
	}
	fs.appendFileSync(contentPath, `${lines.join("\n")}\n`, "utf-8");
}

function activityHash(activity: ActivitySpec): string {
	const canonical = JSON.stringify({ ...activity, contentHash: undefined });
	return crypto.createHash("sha256").update(canonical).digest("hex");
}

function saveActivity(cwd: string, activity: ActivitySpec): string {
	const root = activityRoot(cwd);
	activity.contentHash = activityHash(activity);
	fs.mkdirSync(path.join(root, "specs"), { recursive: true });
	fs.writeFileSync(path.join(root, "specs", `${safeId(activity.id!)}.json`), JSON.stringify(activity, null, 2), "utf-8");
	return exportActivityToObsidian(cwd, activity);
}

function resultPaths(cwd: string, activityId: string, completedAt: string): { latest: string; history: string; global: string } {
	const root = activityRoot(cwd);
	const id = safeId(activityId);
	const stamp = completedAt.replace(/[:.]/g, "-");
	return {
		latest: path.join(root, "results", `${id}.latest.json`),
		history: path.join(root, "results", `${id}-${stamp}.json`),
		global: path.join(root, "last-result.json"),
	};
}

function saveResult(cwd: string, result: ActivityResult): void {
	const targets = resultPaths(cwd, result.activityId, result.completedAt);
	fs.mkdirSync(path.dirname(targets.latest), { recursive: true });
	const json = JSON.stringify(result, null, 2);
	fs.writeFileSync(targets.latest, json, "utf-8");
	fs.writeFileSync(targets.history, json, "utf-8");
	fs.writeFileSync(targets.global, json, "utf-8");
}

function loadResult(cwd: string, activityId?: string): ActivityResult | null {
	const fp = activityId
		? path.join(activityRoot(cwd), "results", `${safeId(activityId)}.latest.json`)
		: path.join(activityRoot(cwd), "last-result.json");
	if (!fs.existsSync(fp)) return null;
	try {
		return JSON.parse(fs.readFileSync(fp, "utf-8"));
	} catch {
		return null;
	}
}

function normalized(value: unknown, caseSensitive = false): string {
	const text = String(value ?? "").trim().replace(/\s+/g, " ").replace(/[.,!?]+$/, "");
	return caseSensitive ? text : text.toLocaleLowerCase();
}

function sameSet(left: unknown[], right: unknown[]): boolean {
	const a = left.map(normalized).sort();
	const b = right.map(normalized).sort();
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function serverGradeItem(spec: any, response: unknown): { correct: boolean | null; earned: number } {
	let correct: boolean | null = null;
	if (spec.type === "choice") correct = normalized(response) === normalized(spec.answer);
	else if (spec.type === "multi-select") correct = Array.isArray(response) && sameSet(response, spec.answers || []);
	else if (spec.type === "text") {
		const answer = normalized(response, spec.caseSensitive);
		const accepted = Array.isArray(spec.acceptedAnswers) ? spec.acceptedAnswers : [];
		const keywords = Array.isArray(spec.containsAll) ? spec.containsAll : [];
		correct = answer.length > 0 && (accepted.some((value: string) => normalized(value, spec.caseSensitive) === answer) ||
			(keywords.length > 0 && keywords.every((value: string) => answer.includes(normalized(value, spec.caseSensitive)))));
	} else if (spec.type === "numeric") {
		const answer = String(response ?? "").trim();
		correct = answer.length > 0 && Number.isFinite(Number(answer)) && Math.abs(Number(answer) - Number(spec.answer)) <= Number(spec.tolerance ?? 0.001);
	} else if (spec.type === "expression" || spec.type === "integral") {
		const answer = normalized(response).replace(/\s/g, "");
		const accepted = [spec.answer, ...(spec.acceptedAnswers || [])].map((value: string) => normalized(value).replace(/\s/g, ""));
		// Equivalent symbolic forms need human review; exact canonical forms are safe to auto-score.
		correct = accepted.includes(answer) ? true : answer ? null : false;
	} else if (spec.type === "cloze") correct = Array.isArray(response) && response.length === (spec.blanks || []).length && response.every((value: unknown, index: number) => (spec.blanks[index]?.answers || []).some((answer: string) => normalized(answer) === normalized(value)));
	else if (spec.type === "order") correct = Array.isArray(response) && response.length === (spec.steps || []).length && response.every((value: unknown, index: number) => normalized(value) === normalized(spec.steps[index]));
	else if (spec.type === "match") {
		if (Array.isArray(response)) correct = response.length === (spec.pairs || []).length && response.every((right: unknown, index: number) => normalized(right) === normalized(spec.pairs[index]?.right));
		else if (response && typeof response === "object") {
			const expected = new Map((spec.pairs || []).map((pair: any) => [normalized(pair.left), normalized(pair.right)]));
			correct = Object.entries(response as Record<string, unknown>).length === expected.size && Object.entries(response as Record<string, unknown>).every(([left, right]) => expected.get(normalized(left)) === normalized(right));
		}
	} else if (spec.type === "reflection" || spec.type === "content") correct = null;
	return { correct, earned: correct === true ? Number(spec.points || 0) : 0 };
}

export function taskTypeForItem(item: any, _mode: ActivityMode): TaskType {
	if (item.taskType) return item.taskType as TaskType;
	// A selected option is recognition even in a timed simulation; it cannot prove application.
	if (["choice", "multi-select"].includes(item.type)) return "recognition";
	if (item.type === "match") return "discrimination";
	if (["numeric", "expression", "integral", "order"].includes(item.type)) return "procedure";
	return "cued-recall";
}

function verifyAndIngestResult(cwd: string, submitted: ActivityResult): ActivityResult {
	const specPath = path.join(activityRoot(cwd), "specs", `${safeId(submitted.activityId)}.json`);
	if (!fs.existsSync(specPath)) throw new Error("Unknown activity specification");
	let activity: ActivitySpec;
	try { activity = JSON.parse(fs.readFileSync(specPath, "utf-8")) as ActivitySpec; }
	catch { throw new Error("Corrupt activity specification; no evidence was recorded"); }
	if (!activity.contentHash || submitted.contentHash !== activity.contentHash) throw new Error("Activity content hash mismatch; reload the signed activity before submitting");
	const submittedById = new Map(submitted.items.map((item) => [item.id, item]));
	const items: ActivityResultItem[] = [];
	let earned = 0;
	let total = 0;
	for (const item of activity.items) {
		if (item.type === "content") continue;
		const raw = submittedById.get(item.id);
		if (!raw) throw new Error(`Missing result for ${item.id}`);
		const grade = serverGradeItem(item, raw.response);
		const verified = { id: item.id, type: item.type, skill: item.skill || "reflection", correct: grade.correct, earned: grade.earned, points: Number(item.points || 0), response: raw.response, latencyMs: raw.latencyMs, confidenceBefore: raw.confidenceBefore, hintsRequested: raw.hintsRequested };
		items.push(verified);
		if (grade.correct !== null) { earned += grade.earned; total += verified.points; }
	}
	const score = total ? Math.round((earned / total) * 100) : 0;
	const pendingReview = items.some((item) => item.correct === null);
	const result: ActivityResult = { version: 1, activityId: activity.id!, title: activity.title, topic: activity.topic, objective: activity.objective, mode: activity.mode || "practice", score, passed: total > 0 && !pendingReview && score >= (activity.passScore || 80), earned, total, startedAt: submitted.startedAt, completedAt: submitted.completedAt, contentHash: activity.contentHash, items };
	const start = result.startedAt || result.completedAt;
	for (const item of items.filter((candidate) => candidate.correct !== null)) {
		const prior = readLearningEvents(cwd, result.topic).filter((event) => event.skillIds.includes(item.skill)).at(-1);
		const taskType = taskTypeForItem(activity.items.find((candidate: any) => candidate.id === item.id), result.mode);
		const event = createLearningEvent({ learnerId: "local-learner", sessionId: `activity:${result.activityId}`, attemptId: `${result.activityId}:${result.completedAt}:${item.id}`, topicId: result.topic, knowledgeObjectIds: [item.skill], skillIds: [item.skill], taskId: `${result.activityId}:${item.id}`, itemFamilyId: (activity.items.find((candidate: any) => candidate.id === item.id) as any)?.itemFamilyId || item.id, mode: result.mode === "simulation" ? "assessment" : activity.sourceMode || "teach", phase: result.mode === "diagnostic" ? "diagnostic" : result.mode === "simulation" ? "assessment" : "practice", taskType, prompt: String((activity.items.find((candidate: any) => candidate.id === item.id) as any)?.prompt || item.id), response: item.response, score: item.points ? item.earned / item.points : 0, correct: item.correct === true, startedAt: start, submittedAt: result.completedAt, latencyMs: item.latencyMs || 0, priorExposureAt: prior?.submittedAt, priorIntervalMs: prior ? Math.max(0, Date.parse(start) - Date.parse(prior.submittedAt)) : undefined, priorEncounterCount: prior ? prior.priorEncounterCount + 1 : 0, confidenceBefore: item.confidenceBefore, hintsRequested: item.hintsRequested || 0, maximumHintDepth: item.hintsRequested ? 1 : 0, assistanceState: item.hintsRequested ? "minimal" : "none", feedbackIds: [], representation: (activity.items.find((candidate: any) => candidate.id === item.id) as any)?.representation || "verbal", novelty: (activity.items.find((candidate: any) => candidate.id === item.id) as any)?.novelty || "repeated", sourceContext: "generated", errorCategory: item.correct ? undefined : taskType === "discrimination" ? "discrimination-error" : "conceptual-model-error", contentVersion: activity.contentHash }, cwd);
		ingestLearningEvent(cwd, event);
	}
	return result;
}

function receiveJson(req: http.IncomingMessage, res: http.ServerResponse, done: (value: any) => void): void {
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
		if (body.length > 1_000_000) req.destroy();
	});
	req.on("end", () => {
		try {
			done(JSON.parse(body));
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Invalid JSON" }));
		}
	});
}

function createServer(): http.Server {
	return http.createServer((req, res) => {
		const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${serverState.port}`);
		if (req.method === "GET" && requestUrl.pathname === "/activity-assets/katex.min.css") {
			const fp = path.join(serverState.cwd, "node_modules", "katex", "dist", "katex.min.css");
			if (fs.existsSync(fp)) {
				res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=86400" });
				res.end(fs.readFileSync(fp));
				return;
			}
		}
		const fontMatch = /^\/activity-assets\/fonts\/([a-zA-Z0-9_.-]+)$/.exec(requestUrl.pathname);
		if (req.method === "GET" && fontMatch) {
			const fontFile = path.basename(fontMatch[1]);
			const fp = path.join(serverState.cwd, "node_modules", "katex", "dist", "fonts", fontFile);
			if (fs.existsSync(fp)) {
				const ext = path.extname(fontFile).toLowerCase();
				const mime = ext === ".woff2" ? "font/woff2" : ext === ".woff" ? "font/woff" : ext === ".ttf" ? "font/ttf" : "application/octet-stream";
				res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=604800" });
				res.end(fs.readFileSync(fp));
				return;
			}
		}
		if (req.method === "POST" && requestUrl.pathname === "/api/activity-result") {
			receiveJson(req, res, (submitted: ActivityResult) => {
				if (!submitted?.activityId || !Array.isArray(submitted.items) || !submitted.completedAt) {
					res.writeHead(422, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Invalid activity result" }));
					return;
				}
				try {
					const verified = verifyAndIngestResult(serverState.cwd, submitted);
					saveResult(serverState.cwd, verified);
					res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ success: true, verifiedScore: verified.score, earned: verified.earned, total: verified.total, passed: verified.passed, items: verified.items.map(({ id, correct, earned }) => ({ id, correct, earned })) }));
				} catch (error) {
					res.writeHead(422, { "Content-Type": "application/json", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: (error as Error).message }));
				}
			});
			return;
		}

		const match = /^\/activity\/([a-zA-Z0-9_-]+)$/.exec(requestUrl.pathname);
		if (req.method === "GET" && match) {
			const fp = path.join(activityRoot(serverState.cwd), "rendered", `${safeId(match[1])}.html`);
			if (fs.existsSync(fp)) {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
				res.end(fs.readFileSync(fp, "utf-8"));
				return;
			}
		}

		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("Activity not found");
	});
}

function ensureServerRunning(cwd: string): Promise<number> {
	serverState.cwd = cwd;
	if (serverState.server?.listening) return Promise.resolve(serverState.port);
	return new Promise((resolve, reject) => {
		let attempts = 0;
		const listen = () => {
			const server = createServer();
			server.once("error", (error: NodeJS.ErrnoException) => {
				server.close();
				if (error.code === "EADDRINUSE" && attempts < 10) {
					attempts++;
					serverState.port++;
					listen();
				} else reject(error);
			});
			server.listen(serverState.port, "127.0.0.1", () => {
				serverState.server = server;
				resolve(serverState.port);
			});
		};
		listen();
	});
}

function openBrowser(url: string): void {
	try {
		if (process.platform === "win32") childProcess.exec(`start "" "${url}"`);
		else if (process.platform === "darwin") childProcess.execFile("open", [url]);
		else childProcess.execFile("xdg-open", [url]);
	} catch {
		// The URL remains available in the tool result when auto-open is unavailable.
	}
}

function renderActivity(cwd: string, activity: ActivitySpec, apiBase: string): string {
	const templatePath = path.join(cwd, ".pi", "skills", "activity-studio", "assets", "activity-runner.html");
	if (!fs.existsSync(templatePath)) throw new Error(`Activity runner template is missing: ${templatePath}`);
	const template = fs.readFileSync(templatePath, "utf-8");
	const serialized = JSON.stringify(compileRichActivity(activity)).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
	return template.replace("__LAS_ACTIVITY__", serialized).replace("__LAS_API__", JSON.stringify(apiBase));
}

function summarizeResult(result: ActivityResult): string {
	const assessed = result.items.filter((item) => item.correct !== null);
	const missed = assessed.filter((item) => !item.correct);
	const bySkill = new Map<string, { earned: number; points: number; missed: number }>();
	for (const item of assessed) {
		const current = bySkill.get(item.skill) || { earned: 0, points: 0, missed: 0 };
		current.earned += item.earned;
		current.points += item.points;
		if (!item.correct) current.missed++;
		bySkill.set(item.skill, current);
	}
	const skills = [...bySkill.entries()]
		.map(([skill, data]) => ({ skill, ...data, percent: data.points ? Math.round((data.earned / data.points) * 100) : 0 }))
		.sort((a, b) => a.percent - b.percent);
	const lines = [
		`Activity result: ${result.title}`,
		`Score: ${result.score}% (${result.earned}/${result.total}) | Target: ${result.passed ? "reached" : "not yet reached"}`,
		`Completed: ${result.completedAt}`,
		"",
		"Skill evidence:",
		...skills.map((skill) => `- ${skill.skill}: ${skill.percent}% (${skill.missed} item${skill.missed === 1 ? "" : "s"} needing review)`),
	];
	const reflections = result.items.filter((item) => item.correct === null && String(item.response || "").trim());
	if (reflections.length) {
		lines.push("", "Ungraded responses:");
		for (const item of reflections) lines.push(`- ${item.skill}: ${String(item.response)}`);
	}
	if (missed.length) lines.push("", `Repair first: ${skills[0]?.skill || missed[0].skill}. Explain the misconception before assigning another attempt.`);
	else lines.push("", "No verified automatic misses. Review pending items, then use an unassisted transfer check before claiming mastery.");
	return lines.join("\n");
}

export default function activityStudio(pi: ExtensionAPI) {
	pi.registerTool({
		name: "open_learning_activity",
		label: "open learning activity",
		description: "Validate a Learning Activity Spec and launch it as a polished interactive local browser activity. Supports rich Markdown, tables, LaTeX, design presets, responsive layouts, content blocks, choice, multi-select, short text, numeric, algebraic expression, integral, cloze, matching, ordering, and reflection items.",
		promptSnippet: "When a custom multi-item activity would improve learning or format match, load the activity-studio skill, construct a valid LAS payload, and call open_learning_activity. Keep answer keys only in private grading fields; never print or place answers in learner-visible prompts, instructions, content blocks, exports, or tool prose. Reveal feedback only after submission.",
		parameters: Type.Object({
			activity: Type.Object({
				version: Type.Optional(Type.Literal(1)),
				id: Type.Optional(Type.String({ description: "Optional stable activity id" })),
				title: Type.String(),
				topic: Type.String(),
				objective: Type.String(),
				mode: Type.Optional(Type.Union([Type.Literal("diagnostic"), Type.Literal("practice"), Type.Literal("simulation")])),
				passScore: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
				instructions: Type.Optional(Type.String()),
				appearance: Type.Optional(Type.Object({
					preset: Type.Optional(Type.Union([Type.Literal("study"), Type.Literal("editorial"), Type.Literal("technical"), Type.Literal("midnight")])),
					accent: Type.Optional(Type.String({ description: "Six-digit hex accent color" })),
					density: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("comfortable"), Type.Literal("spacious")])),
					radius: Type.Optional(Type.Union([Type.Literal("sharp"), Type.Literal("soft")])),
					layout: Type.Optional(Type.Union([Type.Literal("single"), Type.Literal("split")])),
					showItemTypes: Type.Optional(Type.Boolean()),
				})),
				items: Type.Array(Type.Any(), { minItems: 1, maxItems: 50, description: "LAS items; see activity-studio/references/activity-spec.md" }),
			}),
			autoOpenBrowser: Type.Optional(Type.Boolean({ description: "Open the activity in the default browser (default true)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			loadPolicy(cwd); // Fail before publishing a browser form if evidence cannot be saved.
			const checked = validateActivity(params.activity as ActivitySpec);
			if (!checked.activity) {
				return {
					content: [{ type: "text" as const, text: `Activity Spec validation failed:\
- ${checked.errors.join("\
- ")}` }],
					details: { valid: false, errors: checked.errors },
					isError: true,
				};
			}

			const activity = checked.activity;
			const session = readSessionForContext(ctx);
			if (session && session.topic === activity.topic) activity.sourceMode = session.mode;
			const contentPath = saveActivity(cwd, activity);
			const port = await ensureServerRunning(cwd);
			const apiBase = `http://127.0.0.1:${port}`;
			const html = renderActivity(cwd, activity, apiBase);
			const renderedDir = path.join(activityRoot(cwd), "rendered");
			fs.mkdirSync(renderedDir, { recursive: true });
			const htmlPath = path.join(renderedDir, `${safeId(activity.id)}.html`);
			fs.writeFileSync(htmlPath, html, "utf-8");
			const url = `${apiBase}/activity/${encodeURIComponent(activity.id)}`;
			if (params.autoOpenBrowser !== false) openBrowser(url);

			return {
				content: [{
					type: "text" as const,
					text: `Opened “${activity.title}” with ${activity.items.length} items.\
\
URL: ${url}\
Activity ID: ${activity.id}\
\
Obsidian copy: ${contentPath}\
\
When the learner finishes, call get_activity_results with this activity ID.`,
				}],
				details: { valid: true, activityId: activity.id, itemCount: activity.items.length, url, htmlPath, contentPath },
			};
		},
	});

	pi.registerTool({
		name: "get_activity_results",
		label: "get activity results",
		description: "Retrieve the latest submitted browser activity result, including item responses and skill-level evidence, so the tutor can repair gaps and record learning evidence.",
		promptSnippet: "After a learner completes an Activity Studio activity, call get_activity_results. Interpret the weakest skill, repair it, and record meaningful evidence; do not treat the raw score as durable mastery.",
		parameters: Type.Object({
			activityId: Type.Optional(Type.String({ description: "Activity ID returned by open_learning_activity; omit for the most recent submission" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const result = loadResult(cwd, params.activityId);
			if (!result) {
				return { content: [{ type: "text" as const, text: "No submitted result was found. Ask the learner to finish and grade the browser activity first." }] };
			}
			appendActivityFeedback(cwd, result);
			const contentPath = activityContentPath(cwd, result.activityId);
			return { content: [{ type: "text" as const, text: `${summarizeResult(result)}\n\nObsidian activity note updated: ${contentPath}` }], details: { ...result, contentPath } };
		},
	});
}
