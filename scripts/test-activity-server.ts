import activityStudio from "../.pi/extensions/activity-studio.ts";
import { readLearningEvents } from "../.pi/core/learning-events.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "learn-activity-integration-"));
const assets = path.join(cwd, ".pi", "skills", "activity-studio", "assets");
fs.mkdirSync(assets, { recursive: true });
fs.copyFileSync(path.join(process.cwd(), ".pi", "skills", "activity-studio", "assets", "activity-runner.html"), path.join(assets, "activity-runner.html"));
fs.mkdirSync(path.join(cwd, ".pi", "config"), { recursive: true });
fs.copyFileSync(path.join(process.cwd(), ".pi", "config", "learning-policy.json"), path.join(cwd, ".pi", "config", "learning-policy.json"));

const tools = new Map<string, any>();
activityStudio({ registerTool: (tool: any) => tools.set(tool.name, tool) } as any);
const chat = {
	cwd,
	sessionManager: {
		getSessionId: () => "integration-chat",
		getBranch: () => [{ type: "custom", customType: "learning-session-state", data: { version: 2, chatSessionId: "integration-chat", topic: "fixture", mode: "fast-learn", phases: [] } }],
	},
};
const launch = tools.get("open_learning_activity");
const now = () => new Date().toISOString();

async function submit(spec: any, url: string, responses: Record<string, unknown>) {
	const page = await fetch(url);
	const html = await page.text();
	if (!page.ok || !html.includes("activityForm")) throw new Error("Activity page did not serve");
	const serialized = html.match(/const activity=(\{[^\n]+\});/);
	if (!serialized) throw new Error("Activity data is missing from the rendered page");
	let rendered: any;
	try { rendered = JSON.parse(serialized[1]); }
	catch { throw new Error("Activity data was not valid JSON"); }
	if (!rendered.items[0]._promptHtml?.includes("<p>")) throw new Error("Rich content was double-escaped before browser rendering");
	const items = spec.items.filter((item: any) => item.type !== "content").map((item: any) => ({ id: item.id, response: responses[item.id] ?? "", earned: item.points, correct: true }));
	const payload = { activityId: spec.id, contentHash: spec.contentHash, startedAt: now(), completedAt: now(), items, score: 0, passed: true, earned: 999, total: 999 };
	const reply = await fetch(new URL("/api/activity-result", url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
	if (!reply.ok) throw new Error(`Activity submission failed: ${reply.status} ${await reply.text()}`);
	return reply.json();
}

let exitCode = 0;
try {
	const simulated = await launch.execute("sim", { autoOpenBrowser: false, activity: {
		title: "Independent check", topic: "fixture", objective: "Produce and discriminate", mode: "simulation",
		items: [
			{ id: "choice", type: "choice", skill: "selection", prompt: "Which option?", options: ["A", "B"], answer: "A", points: 1, explanation: "A is the target." },
			{ id: "text", type: "text", skill: "production", prompt: "Type the label", acceptedAnswers: ["correct"], points: 1, explanation: "Recall the label." },
			{ id: "integral", type: "integral", skill: "integration", prompt: "Integrate", integrand: "2x", variable: "x", answer: "x^2+C", points: 2, explanation: "Differentiate to check." },
		],
	} }, undefined, undefined, chat);
	const spec = JSON.parse(fs.readFileSync(path.join(cwd, "_learning", "activities", "specs", `${simulated.details.activityId}.json`), "utf8"));
	const verified = await submit(spec, simulated.details.url, { choice: "A", text: "correct", integral: "x*x + C" });
	if (verified.verifiedScore !== 100 || verified.total !== 2 || verified.passed !== false || verified.items.find((item: any) => item.id === "integral")?.correct !== null) throw new Error("Server did not override forged client score and preserve pending symbolic review");
	const events = readLearningEvents(cwd, "fixture");
	if (events.length !== 2 || events.find((event) => event.skillIds.includes("selection"))?.taskType !== "recognition" || events.some((event) => event.skillIds.includes("integration"))) throw new Error("Simulation inflated application evidence or recorded pending answer");

	const practice = await launch.execute("practice", { autoOpenBrowser: false, activity: {
		title: "Changed practice", topic: "fixture", objective: "Use a number", mode: "practice",
		items: [{ id: "n", type: "numeric", skill: "number", prompt: "What is two plus two?", answer: 4, points: 1, explanation: "Add the two quantities." }],
	} }, undefined, undefined, chat);
	const practiceSpec = JSON.parse(fs.readFileSync(path.join(cwd, "_learning", "activities", "specs", `${practice.details.activityId}.json`), "utf8"));
	await submit(practiceSpec, practice.details.url, { n: "4" });
	if (readLearningEvents(cwd, "fixture").find((event) => event.skillIds.includes("number"))?.mode !== "fast-learn") throw new Error("Practice lost its active learning mode");
	console.log("PASS: Signed local activity submission verifies score, preserves pending review, and records the correct mode/task evidence");
} catch (error) {
	console.error(error);
	exitCode = 1;
} finally {
	fs.rmSync(cwd, { recursive: true, force: true });
	process.exit(exitCode); // Activity Studio's local HTTP server is intentionally long-lived in interactive sessions.
}
