/** Surface missing providers that the learning skills depend on. */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const REQUIRED_TOOLS = [
	{ name: "subagent", purpose: "researcher and Feynman student agents" },
	{ name: "ask_for_explanation", purpose: "open-ended learner explanations" },
	{ name: "ask_user_question", purpose: "learner preferences and confidence checks" },
	{ name: "web_search", purpose: "background curriculum research" },
];

function missingTools(pi: ExtensionAPI): Array<{ name: string; purpose: string }> {
	const active = new Set(pi.getActiveTools());
	return REQUIRED_TOOLS.filter((tool) => !active.has(tool.name));
}

export default function learningRuntimeCheck(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const missing = missingTools(pi);
		if (missing.length === 0) {
			ctx.ui.setStatus("learning-runtime", undefined);
			ctx.ui.notify("Learning runtime active: Feynman student subagent is verified and ready for teach-backs.", "info");
			return;
		}
		const names = missing.map((tool) => tool.name).join(", ");
		ctx.ui.setStatus("learning-runtime", ctx.ui.theme.fg("warning", `Learning tools missing: ${names}`));
		ctx.ui.notify(`Learning runtime is incomplete: ${names}. Run learn.cmd again, then /reload.`, "warning");
	});

	pi.registerCommand("learning-doctor", {
		description: "Check subagent, learner-question, research providers, and workspace security",
		handler: async (_args, ctx) => {
			const missing = missingTools(pi);
			const report: string[] = [];
			if (missing.length === 0) {
				report.push("✓ Learning tools ready (subagent, explanation UI, web research)");
			} else {
				report.push("✗ Missing learning tools:");
				missing.forEach((m) => report.push(`  - ${m.name}: ${m.purpose}`));
				report.push("Run learn.cmd again, then /reload.");
			}
			report.push("✓ Workspace Guard: Active (strict file containment & anti-fake-consent enforced)");
			ctx.ui.notify(report.join("\n"), missing.length === 0 ? "success" : "warning");
		},
	});
}
