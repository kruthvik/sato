/**
 * micro-rest — Practice-rest interval pacer for micro-offline consolidation.
 *
 * Research basis: Bönstrup et al. (2019, 2021, Cell Reports) demonstrated that
 * brief 10-second rest intervals between practice trials drive dense hippocampal
 * sharp-wave ripples (80–120 Hz), producing early skill gains up to 4× larger
 * than overnight sleep. Performance improvements accumulate during the rest
 * intervals, not during active practice.
 *
 * The pacer enforces alternating work/rest cycles. During rest intervals, the
 * brain generates ultra-rapid hippocampal replay. Continuous drilling causes
 * synaptic saturation; structured micro-pauses prevent it.
 *
 * Tools:
 *   start_practice_pacer  — Begin a work/rest interval timer
 *   pacer_status          — Check the current cycle state
 *
 * Commands:
 *   /pacer                — Show pacer status
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ── State ───────────────────────────────────────────────────────────────────

interface PacerState {
	active: boolean;
	currentCycle: number;
	totalCycles: number;
	phase: "work" | "rest";
	workSeconds: number;
	restSeconds: number;
	phaseTimeLeft: number;
}

let pacerState: PacerState | null = null;

// ── Extension ───────────────────────────────────────────────────────────────

export default function microRest(pi: ExtensionAPI) {
	// ── start_practice_pacer tool ──────────────────────────────────────────

	pi.registerTool({
		name: "start_practice_pacer",
		label: "start practice pacer",
		description:
			"Start a work/rest interval pacer for micro-offline consolidation. " +
			"Alternates between active practice periods and brief rest intervals. " +
			"During rest, the brain generates dense hippocampal sharp-wave ripples " +
			"that replay newly learned material at compressed speed — producing " +
			"early skill gains up to 4× larger than overnight sleep (Bönstrup et al., 2019). " +
			"Use this during Phase 3 (build/practice) of teach and fast-learn sessions, " +
			"especially for procedural skills, action sequences, and problem-solving practice.",
		promptSnippet:
			"Use start_practice_pacer for a sustained procedural or coding practice block when timed work/rest intervals help. Do not launch it for a single problem, a short explanation, or when the learner wants an uninterrupted attempt.",
		parameters: Type.Object({
			workSeconds: Type.Optional(
				Type.Integer({
					description:
						"Duration of each work (practice) interval in seconds (default: 30). " +
						"For procedural skills, 10–30s is optimal per the research.",
					minimum: 5,
					maximum: 300,
				}),
			),
			restSeconds: Type.Optional(
				Type.Integer({
					description:
						"Duration of each rest interval in seconds (default: 10). " +
						"The research used 10-second rests. Longer is fine but provides " +
						"diminishing returns beyond ~15s.",
					minimum: 5,
					maximum: 60,
				}),
			),
			cycles: Type.Optional(
				Type.Integer({
					description:
						"Number of work/rest cycles (default: 6). " +
						"6 cycles of 30s work + 10s rest = 4 minutes total.",
					minimum: 2,
					maximum: 20,
				}),
			),
			label: Type.Optional(
				Type.String({
					description: "Short description of what's being practiced (shown in the timer)",
				}),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const workSec = params.workSeconds ?? 30;
			const restSec = params.restSeconds ?? 10;
			const totalCycles = params.cycles ?? 6;
			const label = params.label ?? "Practice";
			const totalTime = totalCycles * (workSec + restSec);

			const result = await (ctx as any).ui.custom<{
				completedCycles: number;
				status: "completed" | "stopped";
			} | null>(
				(tui: any, theme: any, _kb: any, done: (result: { completedCycles: number; status: string } | null) => void) => {
					let cycle = 1;
					let phase: "work" | "rest" = "work";
					let timeLeft = workSec;
					let cachedLines: string[] | undefined;
					let cachedWidth = -1;

					pacerState = {
						active: true,
						currentCycle: 1,
						totalCycles,
						phase: "work",
						workSeconds: workSec,
						restSeconds: restSec,
						phaseTimeLeft: workSec,
					};

					const timerHandle = setInterval(() => {
						timeLeft--;
						if (pacerState) pacerState.phaseTimeLeft = timeLeft;

						if (timeLeft <= 0) {
							if (phase === "work") {
								phase = "rest";
								timeLeft = restSec;
							} else {
								// Rest completed — advance cycle
								cycle++;
								if (cycle > totalCycles) {
									clearInterval(timerHandle);
									pacerState = null;
									done({ completedCycles: totalCycles, status: "completed" });
									return;
								}
								phase = "work";
								timeLeft = workSec;
							}
							if (pacerState) {
								pacerState.currentCycle = cycle;
								pacerState.phase = phase;
								pacerState.phaseTimeLeft = timeLeft;
							}
						}
						cachedLines = undefined;
						tui.requestRender();
					}, 1000);

					function handleInput(data: string) {
						if (matchesKey(data, Key.escape)) {
							clearInterval(timerHandle);
							const completed = phase === "rest" ? cycle : cycle - 1;
							pacerState = null;
							done({ completedCycles: Math.max(0, completed), status: "stopped" });
						}
					}

					function render(width: number): string[] {
						if (cachedLines && cachedWidth === width) return cachedLines;

						const lines: string[] = [];
						const add = (text: string) => lines.push(truncateToWidth(text, width));
						const mins = Math.floor(timeLeft / 60);
						const secs = timeLeft % 60;
						const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

						add(theme.fg("accent", "─".repeat(width)));

						if (phase === "work") {
							add(theme.fg("success", `  ⚡ PRACTICE — Cycle ${cycle}/${totalCycles} — ${timeStr}`));
							lines.push("");
							add(theme.fg("text", `  ${label}`));
							add(theme.fg("muted", "  Focus on the task. Active practice builds the neural pattern."));
						} else {
							add(theme.fg("accent", `  🧠 REST — Cycle ${cycle}/${totalCycles} — ${timeStr}`));
							lines.push("");
							add(theme.fg("muted", "  Pause. Your brain is replaying at 20× speed."));
							add(theme.fg("muted", "  Hippocampal sharp-wave ripples are consolidating the skill."));

							// Visual indicator — a calm pulsing bar
							const barWidth = Math.max(10, width - 8);
							const pulsePos = Math.floor((Date.now() / 500) % barWidth);
							const bar = " ".repeat(pulsePos) + "●" + " ".repeat(barWidth - pulsePos - 1);
							add(theme.fg("accent", `  ${bar}`));
						}

						lines.push("");

						// Progress through all cycles
						const totalElapsed =
							(cycle - 1) * (workSec + restSec) +
							(phase === "work" ? workSec - timeLeft : workSec + restSec - timeLeft);
						const overallProgress = totalElapsed / totalTime;
						const progWidth = Math.max(10, width - 8);
						const filled = Math.round(overallProgress * progWidth);
						const progBar = "█".repeat(filled) + "░".repeat(progWidth - filled);
						add(theme.fg("dim", `  ${progBar}`));
						add(theme.fg("dim", `  Overall: ${Math.round(overallProgress * 100)}%`));

						lines.push("");
						add(theme.fg("dim", "  Esc to stop"));
						add(theme.fg("accent", "─".repeat(width)));

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

			pacerState = null;

			if (!result || signal.aborted) {
				return {
					content: [{ type: "text" as const, text: "Practice pacer cancelled." }],
				};
			}

			const lines = [
				result.status === "completed"
					? `✅ Practice pacer complete: ${result.completedCycles} cycles finished.`
					: `Practice pacer stopped after ${result.completedCycles} of ${totalCycles} cycles.`,
				``,
				`Each ${restSec}-second rest interval allowed hippocampal replay at compressed speed.`,
				`The micro-offline gains from these pauses are typically 4× larger than overnight gains.`,
			];

			if (result.completedCycles < totalCycles && result.status !== "completed") {
				lines.push(
					``,
					`Partial practice is still valuable — the completed cycles benefited from micro-consolidation.`,
				);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					completedCycles: result.completedCycles,
					totalCycles,
					workSeconds: workSec,
					restSeconds: restSec,
					status: result.status,
				},
			};
		},
	});

	// ── pacer_status tool ─────────────────────────────────────────────────

	pi.registerTool({
		name: "pacer_status",
		label: "pacer status",
		description: "Check the current state of the micro-rest practice pacer.",
		parameters: Type.Object({}),
		async execute() {
			if (!pacerState || !pacerState.active) {
				return {
					content: [{ type: "text" as const, text: "No practice pacer is currently active." }],
					details: { active: false },
				};
			}
			const { currentCycle, totalCycles, phase, phaseTimeLeft } = pacerState;
			return {
				content: [
					{
						type: "text" as const,
						text: `Practice pacer active: cycle ${currentCycle}/${totalCycles}, ` +
							`${phase} phase, ${phaseTimeLeft}s remaining in phase.`,
					},
				],
				details: pacerState,
			};
		},
	});

	// ── /pacer command ────────────────────────────────────────────────────

	pi.registerCommand("pacer", {
		description: "Show practice pacer status",
		handler: async (_args, ctx: any) => {
			if (pacerState && pacerState.active) {
				ctx.ui.notify(
					`⚡ Pacer: cycle ${pacerState.currentCycle}/${pacerState.totalCycles}, ` +
						`${pacerState.phase} (${pacerState.phaseTimeLeft}s left)`,
					"info",
				);
			} else {
				ctx.ui.notify("No pacer active. Use the practice pacer during intensive skill-building.", "info");
			}
		},
	});
}
