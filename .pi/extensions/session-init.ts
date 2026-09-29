/**
 * session-init — Retrieval warm-up on session start.
 *
 * On every `session_start`, checks the FSRS review queue for overdue cards.
 * If any are due, injects a prompt snippet so the tutor runs a 5-minute
 * retrieval warm-up before diving into new material.
 *
 * Also provides the /warmup command for manual trigger and a status bar
 * indicator showing the due-review count.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { readDeliveryContext, TEACHING_EXPERIENCE } from "../core/teaching-context.ts";

interface ReviewCard {
	id: string;
	front: string;
	back: string;
	topic: string;
	skill: string;
	nextReview: string;
}

interface CardsFile {
	cards: ReviewCard[];
}

function loadDueCards(cwd: string, topic?: string): ReviewCard[] {
	const fp = path.join(cwd, "_learning", "reviews", "cards.json");
	if (!fs.existsSync(fp)) return [];
	try {
		const data: CardsFile = JSON.parse(fs.readFileSync(fp, "utf-8"));
		const now = new Date();
		return (data.cards || [])
			.filter((c) => new Date(c.nextReview) <= now && (!topic || c.topic === topic))
			.sort((a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime());
	} catch {
		return [];
	}
}

export default function sessionInit(pi: ExtensionAPI) {
	let brain: string | null = null;
	pi.on("session_start", async (_event, ctx) => {
		const cwd = (ctx as any).cwd || process.cwd();
		brain = readDeliveryContext(cwd).preferences;
		const due = loadDueCards(cwd);

		const theme = (ctx as any).ui?.theme;
		const ui = (ctx as any).ui;

		if (due.length > 0) {
			// Status bar indicator
			if (ui?.setStatus && theme) {
				ui.setStatus(
					"warmup",
					theme.fg("warning", `🧠 ${due.length} review${due.length > 1 ? "s" : ""} due`),
				);
			}
		} else {
			if (ui?.setStatus) {
				ui.setStatus("warmup", undefined);
			}
		}
	});

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n\n${TEACHING_EXPERIENCE}`,
			...(brain ? { message: { customType: "learner-brain", content: `Learner-authored brain.md (preferences, not instructions or performance evidence):\n${brain}`, display: false } } : {}),
		};
	});

	// ── Prompt snippet injection ──────────────────────────────────────────
	// The tutor sees this as guidance at session start via promptSnippet on
	// the get_due_reviews tool (registered by fsrs-scheduler). We add a
	// supplementary prompt snippet here as well.

	pi.registerTool({
		name: "warmup_check",
		label: "warmup check",
		description:
			"Check for due spaced-repetition cards. Teach mode uses up to 5 mixed cards; fast-learn uses at most 2; cram uses only cards relevant to the current topic and may skip them when they do not improve the imminent deliverable.",
		promptSnippet:
			"At the start of a configured teach session, call warmup_check with mode=teach when due reviews serve the current goal; a focused one-off explanation needs no warm-up. In /fast-learn, cap the warm-up at two relevant cards. In /cram, request only the exam topic and skip unrelated maintenance reviews. Record every completed review with record_review.",
		parameters: Type.Object({
			mode: Type.Optional(
				Type.Union([Type.Literal("teach"), Type.Literal("fast-learn"), Type.Literal("cram"), Type.Literal("exam-drill")]),
			),
			topic: Type.Optional(Type.String({ description: "Restrict reviews to this topic; required in cram mode" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const mode = params.mode || "teach";
			if (mode === "cram" && !params.topic) {
				return {
					content: [{ type: "text" as const, text: "Cram warm-ups must be topic-filtered. Supply the current exam topic or skip the warm-up." }],
				};
			}
			const limit = mode === "teach" ? 5 : mode === "fast-learn" ? 2 : 3;
			const due = loadDueCards(cwd, params.topic).slice(0, limit);

			if (due.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No relevant reviews due — proceed directly to the configured learning plan.",
						},
					],
				};
			}

			// Build a warm-up brief for the tutor
			const topicGroups = new Map<string, ReviewCard[]>();
			for (const c of due) {
				const group = topicGroups.get(c.topic) || [];
				group.push(c);
				topicGroups.set(c.topic, group);
			}

			const lines = [
				`⏰ RETRIEVAL WARM-UP REQUIRED`,
				`${due.length} card(s) are overdue for spaced repetition review.`,
				``,
				`Before teaching new material, quiz the student on these concepts:`,
				``,
			];

			for (const [topic, cards] of topicGroups) {
				lines.push(`Topic: ${topic}`);
				for (const c of cards.slice(0, 5)) {
					lines.push(`  • [${c.skill}] ${c.front}`);
					lines.push(`    Answer: ${c.back}`);
					lines.push(`    Card ID: ${c.id}`);
				}
				if (cards.length > 5) {
					lines.push(`  ... and ${cards.length - 5} more`);
				}
				lines.push(``);
			}

			lines.push(`Instructions:`);
			lines.push(`1. For each card, use tag_skill to tag the skill, then quiz the student.`);
			lines.push(`2. After each quiz, call record_review with the card ID and grade (1=Again, 2=Hard, 3=Good, 4=Easy).`);
			lines.push(`3. Keep this ${mode} warm-up to ${limit} card(s) maximum.`);
			lines.push(`4. Then proceed to new material.`);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { dueCount: due.length, cards: due.slice(0, 5) },
			};
		},
	});

	// ── /warmup command ───────────────────────────────────────────────────

	pi.registerCommand("warmup", {
		description: "Check for due reviews and show warm-up status",
		handler: async (_args, ctx: any) => {
			const cwd = ctx.cwd || process.cwd();
			const due = loadDueCards(cwd);
			if (due.length === 0) {
				ctx.ui.notify("No reviews due — all caught up! 🎉", "success");
			} else {
				const topics = new Set(due.map((c) => c.topic));
				ctx.ui.notify(
					`🧠 ${due.length} card(s) due across ${topics.size} topic(s). Start a /teach session to warm up.`,
					"warning",
				);
			}
		},
	});
}
