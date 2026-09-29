/**
 * blurt — Structured free-recall tool for deep retrieval practice.
 *
 * Implements the four-phase "blurting" protocol from laboratory free-recall
 * paradigms. Unlike atomized flashcards, blurting requires reconstructing
 * complete conceptual schemas without external prompts, forcing hippocampal
 * pattern completion and bypassing perirhinal familiarity signals.
 *
 * Four-phase cycle:
 *   1. READ    — Learner reads a discrete conceptual unit (timed, no marking)
 *   2. RECALL  — Source is occluded; learner generates everything recoverable
 *   3. COMPARE — Side-by-side discrepancy analysis (hits, omissions, errors)
 *   4. RE-RETRIEVE — Learner re-recalls only the missed/incorrect components
 *
 * Tools:
 *   start_blurt     — Begin a timed blurt cycle on a conceptual unit
 *   evaluate_blurt  — Run structured discrepancy analysis on a completed blurt
 *
 * Persistence:
 *   Blurt records are saved to `_learning/blurts/<topic>-<timestamp>.json`
 *   so the tutor can reference past performance and the BKT engine can
 *   incorporate free-recall evidence.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createLearningEvent, ingestLearningEvent, readLearningEvents, type EvidencePhase, type NoveltyType, type RepresentationType } from "../core/learning-events.ts";
import type { LearningMode } from "../core/policy.ts";

// ── Types ───────────────────────────────────────────────────────────────────

interface BlurtRecord {
	id: string;
	topic: string;
	skill: string;
	sourceText: string;
	recalledText: string;
	sourcePropositions: string[];
	hits: string[];
	omissions: string[];
	errors: string[];
	hitRate: number;
	readSeconds: number;
	recallSeconds: number;
	createdAt: string;
}

interface BlurtsFile {
	version: number;
	blurts: BlurtRecord[];
	lastUpdated: string;
}

// ── File I/O ────────────────────────────────────────────────────────────────

function blurtsDir(cwd: string): string {
	return path.join(cwd, "_learning", "blurts");
}

function blurtsFilePath(cwd: string): string {
	return path.join(blurtsDir(cwd), "blurts.json");
}

function loadBlurts(cwd: string): BlurtsFile {
	const fp = blurtsFilePath(cwd);
	if (fs.existsSync(fp)) {
		try {
			return JSON.parse(fs.readFileSync(fp, "utf-8"));
		} catch {
			// corrupted — start fresh
		}
	}
	return { version: 1, blurts: [], lastUpdated: new Date().toISOString() };
}

function saveBlurts(cwd: string, data: BlurtsFile): void {
	const dir = blurtsDir(cwd);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	data.lastUpdated = new Date().toISOString();
	fs.writeFileSync(blurtsFilePath(cwd), JSON.stringify(data, null, 2), "utf-8");
}

// ── Proposition extraction ──────────────────────────────────────────────────

/**
 * Extract key propositions from text. Splits on sentence boundaries and
 * filters out trivial filler. The tutor is expected to refine these via
 * evaluate_blurt, but this provides a reasonable automated baseline.
 */
function extractPropositions(text: string): string[] {
	return text
		.replace(/\r\n/g, "\n")
		.split(/(?<=[.!?;])\s+|\n{2,}/)
		.map((s) => s.trim())
		.filter((s) => s.length > 15) // filter trivial fragments
		.filter((s) => !/^(note|see|cf\.|e\.g\.|i\.e\.)/i.test(s));
}

// ── TUI helpers ─────────────────────────────────────────────────────────────

function createEditorTheme(theme: any): EditorTheme {
	return {
		borderColor: (s) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t: string) => theme.fg("accent", t),
			selectedText: (t: string) => theme.fg("accent", t),
			description: (t: string) => theme.fg("muted", t),
			scrollInfo: (t: string) => theme.fg("dim", t),
			noMatch: (t: string) => theme.fg("warning", t),
		},
	};
}

function addWrapped(lines: string[], text: string, width: number, indent = ""): void {
	const contentWidth = Math.max(1, width - indent.length);
	for (const line of wrapTextWithAnsi(text, contentWidth)) {
		lines.push(truncateToWidth(`${indent}${line}`, width));
	}
}

function formatTimer(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function blurt(pi: ExtensionAPI) {
	// ── start_blurt tool ──────────────────────────────────────────────────

	pi.registerTool({
		name: "start_blurt",
		label: "start blurt",
		description:
			"Begin a timed free-recall (blurt) cycle. The learner reads the source text for a timed window, " +
			"then the source is hidden and they write everything they can recall. Returns the recalled text " +
			"for discrepancy analysis. This is the strongest form of retrieval practice — it bypasses " +
			"perirhinal familiarity by forcing hippocampal pattern completion without any external cues.",
		promptSnippet:
			"Use start_blurt for a planned, timed free-recall cycle over source material. A single quick recall question does not need the timed blurt UI. When a blurt cycle is chosen, keep the source hidden during recall and evaluate the actual response afterward.",
		parameters: Type.Object({
			topic: Type.String({ description: "Topic slug for evidence tracking" }),
			skill: Type.String({ description: "Specific skill/concept being blurted" }),
			sourceText: Type.String({
				description:
					"The conceptual unit to recall. Should be a discrete, self-contained chunk — " +
					"not an entire chapter. 200–500 words is ideal.",
			}),
			readSeconds: Type.Optional(
				Type.Integer({
					description: "Seconds for the reading phase (default: 90). Shorter for familiar material.",
					minimum: 15,
					maximum: 600,
				}),
			),
			recallSeconds: Type.Optional(
				Type.Integer({
					description: "Seconds for the recall phase (default: 120). Longer for dense material.",
					minimum: 30,
					maximum: 600,
				}),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const readTime = params.readSeconds ?? 90;
			const recallTime = params.recallSeconds ?? 120;

			const result = await (ctx as any).ui.custom<{ recalled: string; phase: string } | null>(
				(tui: any, theme: any, _kb: any, done: (result: { recalled: string; phase: string } | null) => void) => {
					let phase: "read" | "recall" | "done" = "read";
					let timeLeft = readTime;
					let cachedLines: string[] | undefined;
					let cachedWidth = -1;
					const editor = new Editor(tui, createEditorTheme(theme));
					editor.focused = false;
					editor.disableSubmit = true;

					let timerHandle: ReturnType<typeof setInterval> | null = null;

					function refresh() {
						cachedLines = undefined;
						tui.requestRender();
					}

					function startTimer() {
						timerHandle = setInterval(() => {
							timeLeft--;
							if (timeLeft <= 0) {
								if (timerHandle) clearInterval(timerHandle);
								if (phase === "read") {
									phase = "recall";
									timeLeft = recallTime;
									editor.focused = true;
									startTimer();
								} else if (phase === "recall") {
									phase = "done";
									const recalled = editor.getText().trim();
									done({ recalled, phase: "timeout" });
									return;
								}
							}
							refresh();
						}, 1000);
					}

					startTimer();

					function handleInput(data: string) {
						if (matchesKey(data, Key.escape)) {
							if (timerHandle) clearInterval(timerHandle);
							done(null);
							return;
						}

						if (phase === "read") {
							// During reading, Enter skips to recall early
							if (matchesKey(data, Key.enter)) {
								if (timerHandle) clearInterval(timerHandle);
								phase = "recall";
								timeLeft = recallTime;
								editor.focused = true;
								startTimer();
								refresh();
							}
							return;
						}

						if (phase === "recall") {
							// Ctrl+Enter submits early
							if (data === "\x0d" && editor.getText().trim().length > 0) {
								// plain Enter — let the editor handle newlines via Ctrl+J
								// We need a way to submit. Use Ctrl+S (0x13).
							}
							if (data === "\x13") {
								// Ctrl+S: submit
								if (timerHandle) clearInterval(timerHandle);
								const recalled = editor.getText().trim();
								done({ recalled, phase: "submitted" });
								return;
							}
							editor.handleInput(data);
							refresh();
						}
					}

					function render(width: number): string[] {
						if (cachedLines && cachedWidth === width) return cachedLines;

						const lines: string[] = [];
						const add = (text: string) => lines.push(truncateToWidth(text, width));

						add(theme.fg("accent", "─".repeat(width)));

						if (phase === "read") {
							add(theme.fg("accent", ` 📖 READING PHASE — ${formatTimer(timeLeft)} remaining`));
							add(theme.fg("muted", " Read carefully. No highlighting, no notes. Absorb the structure."));
							lines.push("");
							addWrapped(lines, theme.fg("text", params.sourceText), width, "  ");
							lines.push("");
							add(theme.fg("dim", " Enter to skip to recall • Esc to cancel"));
						} else if (phase === "recall") {
							add(theme.fg("warning", ` ✍️  RECALL PHASE — ${formatTimer(timeLeft)} remaining`));
							add(theme.fg("muted", " Source is hidden. Write everything you remember."));
							add(theme.fg("muted", " Include relationships, conditions, sequences — not just terms."));
							lines.push("");
							for (const line of editor.render(width)) lines.push(line);
							lines.push("");
							add(theme.fg("dim", " Type to recall • Ctrl+J newline • Ctrl+S submit • Esc cancel"));
						}

						add(theme.fg("accent", "─".repeat(width)));

						if (phase !== "recall" || !editor.focused) {
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

			if (!result || signal.aborted) {
				return {
					content: [{ type: "text" as const, text: "Blurt cancelled." }],
				};
			}

			// Persist the raw blurt for evaluate_blurt to process
			const cwd = (ctx as any).cwd || process.cwd();
			const blurtId = crypto.randomUUID();
			const record: BlurtRecord = {
				id: blurtId,
				topic: params.topic.trim(),
				skill: params.skill.trim(),
				sourceText: params.sourceText,
				recalledText: result.recalled,
				sourcePropositions: extractPropositions(params.sourceText),
				hits: [],
				omissions: [],
				errors: [],
				hitRate: 0,
				readSeconds: readTime,
				recallSeconds: recallTime,
				createdAt: new Date().toISOString(),
			};

			const data = loadBlurts(cwd);
			data.blurts.push(record);
			saveBlurts(cwd, data);

			const sourceProps = record.sourcePropositions;

			return {
				content: [
					{
						type: "text" as const,
						text: [
							`Blurt complete (${result.phase}).`,
							``,
							`**Recalled text:**`,
							result.recalled,
							``,
							`**Source propositions extracted (${sourceProps.length}):**`,
							...sourceProps.map((p, i) => `${i + 1}. ${p}`),
							``,
							`Blurt ID: ${blurtId}`,
							``,
							`Now run evaluate_blurt to score the discrepancy, or evaluate manually ` +
								`and call record_learning_evidence with evidenceType: "free-recall".`,
						].join("\n"),
					},
				],
				details: {
					blurtId,
					recalledText: result.recalled,
					sourcePropositions: sourceProps,
					topic: params.topic,
					skill: params.skill,
				},
			};
		},
	});

	// ── evaluate_blurt tool ───────────────────────────────────────────────

	pi.registerTool({
		name: "evaluate_blurt",
		label: "evaluate blurt",
		description:
			"Score a completed blurt by classifying each source proposition as a hit (correctly recalled), " +
			"omission (not mentioned), or error (recalled incorrectly). Updates the blurt record and returns " +
			"a structured result suitable for record_learning_evidence. The tutor should call this after " +
			"manually reviewing the recalled text against the source propositions.",
		promptSnippet:
			"TOOL-FIRST MANDATE: Always call evaluate_blurt after a blurt completes to classify hits, omissions, and errors and automatically calculate evidence scores.",
		parameters: Type.Object({
			blurtId: Type.String({ description: "The blurt ID returned by start_blurt" }),
			hits: Type.Array(Type.String(), {
				description: "Source propositions (or their indices) that were correctly recalled",
			}),
			omissions: Type.Array(Type.String(), {
				description: "Source propositions that were missing from the recall",
			}),
			errors: Type.Array(Type.String(), {
				description: "Propositions that were recalled incorrectly (with a note on the error)",
			}),
			mode: Type.Optional(Type.Union([Type.Literal("teach"), Type.Literal("fast-learn"), Type.Literal("cram"), Type.Literal("project"), Type.Literal("assessment"), Type.Literal("maintenance"), Type.Literal("exam-drill")])),
			phase: Type.Optional(Type.Union([Type.Literal("diagnostic"), Type.Literal("practice"), Type.Literal("assessment"), Type.Literal("review")])),
			representation: Type.Optional(Type.Union([Type.Literal("verbal"), Type.Literal("symbolic"), Type.Literal("graphical"), Type.Literal("spatial"), Type.Literal("procedural"), Type.Literal("mixed")])),
			novelty: Type.Optional(Type.Union([Type.Literal("repeated"), Type.Literal("isomorphic"), Type.Literal("near-transfer"), Type.Literal("far-transfer"), Type.Literal("authentic")])),
			confidenceBefore: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const data = loadBlurts(cwd);
			const record = data.blurts.find((b) => b.id === params.blurtId);

			if (!record) {
				return {
					content: [{ type: "text" as const, text: `Blurt not found: ${params.blurtId}` }],
				};
			}

			record.hits = params.hits;
			record.omissions = params.omissions;
			record.errors = params.errors;

			const totalProps = params.hits.length + params.omissions.length + params.errors.length;
			record.hitRate = totalProps > 0 ? params.hits.length / totalProps : 0;

			saveBlurts(cwd, data);

			// Build and ingest the evidence atomically. The agent no longer needs a
			// follow-up call that can be forgotten or attributed to the wrong skill.
			// Errors count as worse than omissions (an error is an active misconception)
			const score = totalProps > 0
				? Math.max(0, (params.hits.length - params.errors.length * 0.5) / totalProps)
				: 0;

			const priorEvents = readLearningEvents(cwd, record.topic).filter((event) => event.skillIds.includes(record.skill));
			const prior = priorEvents.at(-1);
			const submittedAt = new Date().toISOString();
			const startedAt = new Date(Date.parse(submittedAt) - record.recallSeconds * 1000).toISOString();
			const event = createLearningEvent({
				learnerId: "local-learner",
				sessionId: (ctx as any).sessionManager?.getSessionId?.() || "local-session",
				attemptId: record.id,
				topicId: record.topic,
				knowledgeObjectIds: [record.skill],
				skillIds: [record.skill],
				taskId: `blurt:${record.id}`,
				itemFamilyId: `blurt:${record.skill}`,
				mode: (params.mode || "teach") as LearningMode,
				phase: (params.phase || "assessment") as EvidencePhase,
				taskType: "free-recall",
				prompt: `Reconstruct ${record.skill} from memory`,
				response: record.recalledText,
				score,
				correct: score >= 0.7,
				startedAt,
				submittedAt,
				latencyMs: record.recallSeconds * 1000,
				priorExposureAt: prior?.submittedAt,
				priorIntervalMs: prior ? Math.max(0, Date.parse(startedAt) - Date.parse(prior.submittedAt)) : undefined,
				priorEncounterCount: priorEvents.length,
				confidenceBefore: params.confidenceBefore,
				hintsRequested: 0,
				maximumHintDepth: 0,
				assistanceState: "none",
				feedbackIds: ["blurt-discrepancy"],
				feedbackShownAt: submittedAt,
				representation: (params.representation || "verbal") as RepresentationType,
				novelty: (params.novelty || "repeated") as NoveltyType,
				sourceContext: "learner-supplied",
				errorCategory: params.errors.length ? "conceptual-model-error" : params.omissions.length ? "memory-failure" : undefined,
				contentVersion: "blurt-v1",
			}, cwd);
			const ingestion = ingestLearningEvent(cwd, event);

			const lines = [
				`📊 Blurt Evaluation: "${record.skill}" in "${record.topic}"`,
				`${"─".repeat(50)}`,
				`Hits: ${params.hits.length} / ${totalProps} propositions correctly recalled`,
				`Omissions: ${params.omissions.length} (missing from recall)`,
				`Errors: ${params.errors.length} (recalled incorrectly)`,
				`Hit rate: ${(record.hitRate * 100).toFixed(0)}%`,
				`Evidence score: ${(score * 100).toFixed(0)}%`,
				``,
			];

			if (params.omissions.length > 0) {
				lines.push(`**Omissions to re-retrieve:**`);
				for (const o of params.omissions) {
					lines.push(`  • ${o}`);
				}
			}
			if (params.errors.length > 0) {
				lines.push(`**Errors to correct:**`);
				for (const e of params.errors) {
					lines.push(`  ✗ ${e}`);
				}
			}

			lines.push(``, ingestion.accepted ? `Evidence recorded atomically as ${event.eventId}.` : `Evidence rejected: ${ingestion.errors.join("; ")}`);

			if (params.omissions.length > 0 || params.errors.length > 0) {
				lines.push(
					``,
					`Then run the re-retrieval phase: ask the learner to recall ONLY the ` +
						`omitted and incorrect items without reopening the source.`,
				);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					blurtId: record.id,
					hitRate: record.hitRate,
					score,
					hits: params.hits.length,
					omissions: params.omissions.length,
					errors: params.errors.length,
					topic: record.topic,
					skill: record.skill,
					eventId: event.eventId,
					ingestion,
				},
			};
		},
	});
}
