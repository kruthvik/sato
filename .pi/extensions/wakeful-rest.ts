/**
 * wakeful-rest — Post-encoding consolidation protection timer.
 *
 * Research basis: Dewar et al. demonstrated that 10–15 minutes of quiet rest
 * immediately after encoding significantly boosts retention at 7+ day delays
 * by shielding early synaptic consolidation from retroactive interference.
 *
 * During the rest period, the tool blocks content-presentation tools via a
 * prompt snippet and displays a minimal, calming timer. The brain generates
 * hippocampal replay during this window — introducing novel sensory inputs
 * or cognitive tasks disrupts the ongoing protein-synthesis cascade.
 *
 * Tools:
 *   start_wakeful_rest  — Begin a timed distraction-free rest period
 *   rest_status         — Check if a rest period is active
 *
 * Commands:
 *   /rest               — Show rest status or start a quick 10-minute rest
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { getSessionMemoryController } from "../core/memory-controller.ts";

// ── State ───────────────────────────────────────────────────────────────────

let restActive = false;
let restStartedAt: Date | null = null;
let restDurationMinutes = 10;

// ── Extension ───────────────────────────────────────────────────────────────

export default function wakefulRest(pi: ExtensionAPI) {
	// ── start_wakeful_rest tool ────────────────────────────────────────────

	pi.registerTool({
		name: "start_wakeful_rest",
		label: "start wakeful rest",
		description:
			"Begin a timed wakeful rest period to protect early memory consolidation. " +
			"During rest, the learner should sit quietly without engaging in cognitive tasks, " +
			"checking their phone, or consuming new content. The tool displays a calming timer " +
			"and blocks until the rest period completes. " +
			"Use this after intensive encoding blocks (Phase 3 retrieval, blurt cycles, " +
			"dense concept acquisition) to shield fragile engrams from retroactive interference. " +
			"Research shows 10–15 minutes of quiet rest after encoding significantly improves " +
			"retention at 7+ day delays (Dewar et al.).",
		promptSnippet:
			"After completing a dense retrieval block, blurt cycle, or the build phase of a " +
			"teach/fast-learn session, consider calling start_wakeful_rest to protect " +
			"early synaptic consolidation. Do not present new material, questions, or " +
			"cognitive tasks while a rest period is active.",
		parameters: Type.Object({
			minutes: Type.Optional(
				Type.Integer({
					description:
						"Duration of the rest period in minutes (default: 10). " +
						"Research supports 10–15 minutes. Shorter periods still help.",
					minimum: 2,
					maximum: 20,
				}),
			),
			reason: Type.Optional(
				Type.String({
					description:
						"Brief reason for the rest (shown to learner), e.g. " +
						"'Protecting the dense encoding block we just completed'",
				}),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const minutes = params.minutes ?? 10;
			const totalSeconds = minutes * 60;
			const reason = params.reason ?? "Protecting recently encoded material";

			restActive = true;
			restStartedAt = new Date();
			restDurationMinutes = minutes;

			const ui = (ctx as any).ui;
			if (ui?.setStatus) {
				ui.setStatus("rest", ui.theme?.fg("accent", `🧘 Resting (${minutes} min)`) ?? `🧘 Resting`);
			}

			const result = await ui.custom<"completed" | "skipped" | null>(
				(tui: any, theme: any, _kb: any, done: (result: "completed" | "skipped" | null) => void) => {
					let timeLeft = totalSeconds;
					let cachedLines: string[] | undefined;
					let cachedWidth = -1;

					const timerHandle = setInterval(() => {
						timeLeft--;
						if (timeLeft <= 0) {
							clearInterval(timerHandle);
							done("completed");
							return;
						}
						cachedLines = undefined;
						tui.requestRender();
					}, 1000);

					function handleInput(data: string) {
						if (matchesKey(data, Key.escape)) {
							clearInterval(timerHandle);
							done("skipped");
							return;
						}
						// No other input accepted during rest
					}

					function render(width: number): string[] {
						if (cachedLines && cachedWidth === width) return cachedLines;

						const lines: string[] = [];
						const add = (text: string) => lines.push(truncateToWidth(text, width));
						const mins = Math.floor(timeLeft / 60);
						const secs = timeLeft % 60;
						const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

						// Calculate progress
						const elapsed = totalSeconds - timeLeft;
						const progress = elapsed / totalSeconds;
						const barWidth = Math.max(10, width - 8);
						const filled = Math.round(progress * barWidth);
						const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

						lines.push("");
						lines.push("");
						add(theme.fg("accent", "─".repeat(width)));
						lines.push("");
						add(theme.fg("accent", `  🧘 WAKEFUL REST — ${timeStr} remaining`));
						lines.push("");
						add(theme.fg("muted", `  ${reason}`));
						lines.push("");
						add(theme.fg("accent", `  ${bar}`));
						lines.push("");
						add(theme.fg("muted", "  Sit quietly. No phone, no reading, no new tasks."));
						add(theme.fg("muted", "  Your brain is replaying and stabilizing what you just learned."));
						lines.push("");
						add(theme.fg("dim", "  Esc to skip (not recommended)"));
						lines.push("");
						add(theme.fg("accent", "─".repeat(width)));
						lines.push("");

						cachedLines = lines;
						cachedWidth = width;
						return lines;
					}

					return {
						render,
						invalidate: () => {
							cachedLines = undefined;
						},
						handleInput,
					};
				},
			);

			restActive = false;
			restStartedAt = null;

			if (ui?.setStatus) {
				ui.setStatus("rest", undefined);
			}

			if (!result || signal.aborted) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Wakeful rest cancelled. Early consolidation may be less effective.",
						},
					],
				};
			}

			if (result === "skipped") {
				return {
					content: [
						{
							type: "text" as const,
							text: `Wakeful rest skipped after some time. Partial rest is still beneficial — ` +
								`the first few minutes provide the most consolidation value.`,
						},
					],
				};
			}

			const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.();
			if (sessionId) getSessionMemoryController(sessionId).registerRestPause();

			return {
				content: [
					{
						type: "text" as const,
						text: [
							`✅ Wakeful rest complete (${minutes} minutes).`,
							``,
							`Early synaptic consolidation has had time to stabilize.`,
							`The encoded material is now more resistant to retroactive interference.`,
							``,
							`Ready to continue learning.`,
						].join("\n"),
					},
				],
			};
		},
	});

	// ── rest_status tool ──────────────────────────────────────────────────

	pi.registerTool({
		name: "rest_status",
		label: "rest status",
		description:
			"Check whether a wakeful rest period is currently active. " +
			"If active, do not present new learning material.",
		parameters: Type.Object({}),
		async execute() {
			if (!restActive || !restStartedAt) {
				return {
					content: [{ type: "text" as const, text: "No wakeful rest period is active." }],
					details: { active: false },
				};
			}
			const elapsed = Math.floor((Date.now() - restStartedAt.getTime()) / 1000);
			const remaining = Math.max(0, restDurationMinutes * 60 - elapsed);
			const mins = Math.floor(remaining / 60);
			const secs = remaining % 60;
			return {
				content: [
					{
						type: "text" as const,
						text: `🧘 Wakeful rest in progress: ${mins}:${secs.toString().padStart(2, "0")} remaining. ` +
							`Do not present new material.`,
					},
				],
				details: { active: true, remainingSeconds: remaining },
			};
		},
	});

	// ── /rest command ─────────────────────────────────────────────────────

	pi.registerCommand("rest", {
		description: "Show rest status or prompt for a wakeful rest period",
		handler: async (_args, ctx: any) => {
			if (restActive && restStartedAt) {
				const elapsed = Math.floor((Date.now() - restStartedAt.getTime()) / 1000);
				const remaining = Math.max(0, restDurationMinutes * 60 - elapsed);
				const mins = Math.floor(remaining / 60);
				const secs = remaining % 60;
				ctx.ui.notify(`🧘 Rest active: ${mins}:${secs.toString().padStart(2, "0")} remaining`, "info");
			} else {
				ctx.ui.notify(
					"No rest period active. After intensive encoding, ask the tutor to run a wakeful rest.",
					"info",
				);
			}
		},
	});
}
