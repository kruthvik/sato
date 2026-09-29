/** Internal Obsidian notes used as retrieval context, never as mastery evidence. */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { readLearningEvents, type LearningEventV1 } from "./learning-events.ts";
import { youtubeVideoId } from "./youtube-transcript.ts";

export type SourceKind = "youtube" | "webpage" | "document" | "book" | "other";
export type SourceBasis = "transcript" | "full-text" | "excerpt" | "metadata-only";

function topicSlug(topic: string): string {
	return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general";
}

export function garageTopicDir(cwd: string, topic: string): string {
	const id = crypto.createHash("sha256").update(topic.trim().toLowerCase()).digest("hex").slice(0, 8);
	return path.join(cwd, "_learning", "garage", `${topicSlug(topic).slice(0, 64)}-${id}`);
}

function saveNote(file: string, body: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.${crypto.randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporary, body, "utf-8");
		fs.renameSync(temporary, file);
	} finally {
		if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
	}
}

function wikiLink(cwd: string, candidate: string): string | null {
	const relative = candidate.replace(/\\/g, "/").replace(/\.md$/i, "");
	if (!/^(?:_learning\/garage|content|sources)\/[a-z0-9_./-]+$/i.test(relative) || relative.split("/").includes("..")) return null;
	const file = path.resolve(cwd, `${relative}.md`);
	if (!fs.existsSync(file)) return null;
	return `[[${relative}]]`;
}

function connections(cwd: string, paths: string[]): string {
	const links = [...new Set(paths.map((item) => wikiLink(cwd, item)).filter((item): item is string => Boolean(item)))];
	return links.length ? `\n## Connections\n\n${links.map((link) => `- ${link}`).join("\n")}\n` : "";
}

function topicConnections(cwd: string, topic: string): string[] {
	const topicNote = `content/topics/${topicSlug(topic)}.md`;
	const sessions = path.join(garageTopicDir(cwd, topic), "sessions");
	const recentSessions = fs.existsSync(sessions)
		? fs.readdirSync(sessions).filter((name) => name.endsWith(".md"))
			.map((name) => path.join(sessions, name))
			.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, 3)
			.map((file) => path.relative(cwd, file).replace(/\\/g, "/"))
		: [];
	return [topicNote, ...recentSessions];
}

export function saveSessionGarage(cwd: string, session: {
	chatSessionId: string; topic: string; mode: string; objective: string; deliverable: string;
	currentPhase: string; nextPriority: string | null; configuredAt: string; lastUpdated: string;
	readinessLabel?: string; deadline?: string | null; retentionHorizon?: string | null;
	phases?: Array<{ label: string; minutes: number; status: string }>;
}): string {
	const id = session.chatSessionId.replace(/[^a-z0-9-]/gi, "-").slice(0, 80);
	const file = path.join(garageTopicDir(cwd, session.topic), "sessions", `${id}.md`);
	const topicNote = `content/topics/${topicSlug(session.topic)}.md`;
	const body = [
		"---", "tags: [learning/garage, learning/session]", `topic: ${JSON.stringify(session.topic)}`,
		`chat: ${JSON.stringify(session.chatSessionId)}`, `updated: ${JSON.stringify(session.lastUpdated)}`, "---", "",
		`# ${session.topic} — session context`, "",
		`- Mode: ${session.mode}`, `- Objective: ${session.objective}`, `- Output: ${session.deliverable}`,
		`- Current phase: ${session.currentPhase}`, `- Next priority: ${session.nextPriority || "not set"}`,
		`- Readiness target: ${session.readinessLabel || "unspecified"}`,
		`- Deadline: ${session.deadline || "none"}`, `- Retention horizon: ${session.retentionHorizon || "unspecified"}`,
		"- Learner preferences: [[brain]] (self-report only)",
		`- Started: ${session.configuredAt}`, "",
		"## Phase handoff", "",
		...(session.phases || []).map((phase) => `- ${phase.label}: ${phase.status} (${phase.minutes} min)`), "",
		"This is a planning handoff. Mastery and gaps come from recorded learner performance, not this note.",
		connections(cwd, [topicNote]),
	].join("\n");
	saveNote(file, body);
	return path.relative(cwd, file).replace(/\\/g, "/");
}

export function saveSourceGarage(cwd: string, input: {
	topic: string; kind: SourceKind; origin: string; basis: SourceBasis; summary?: string;
	evidenceExcerpt?: string; keyPoints?: string[]; links?: string[];
}): string {
	if (input.basis === "metadata-only" && (input.summary?.trim() || input.keyPoints?.length)) {
		throw new Error("A source summary requires inspected transcript or source text; metadata alone is insufficient.");
	}
	if (input.basis !== "metadata-only" && !input.summary?.trim()) throw new Error("Summarize the inspected source text before capture.");
	if (input.basis !== "metadata-only" && !input.evidenceExcerpt?.trim()) throw new Error("Provide a short excerpt from the inspected source text.");
	const origin = input.kind === "youtube" ? `https://www.youtube.com/watch?v=${youtubeVideoId(input.origin)}` : input.origin;
	const id = crypto.createHash("sha256").update(`${input.kind}:${origin}`).digest("hex").slice(0, 12);
	const file = path.join(garageTopicDir(cwd, input.topic), "sources", `${input.kind}-${id}.md`);
	const prior = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : [
		"---", "tags: [learning/garage, learning/source]", `topic: ${JSON.stringify(input.topic)}`,
		`kind: ${input.kind}`, "---", "", `# Source: ${origin}`, "",
		`Origin: ${origin}`, "",
	].join("\n");
	const update = [
		`## Captured ${new Date().toISOString()}`, "",
		`Evidence inspected: ${input.basis}`,
		input.evidenceExcerpt?.trim() ? `\nEvidence sample: ${input.evidenceExcerpt.trim().slice(0, 1000)}` : "",
		input.summary?.trim() ? `\n### Summary\n\n${input.summary.trim()}` : "",
		input.keyPoints?.length ? `\n### Key points\n\n${input.keyPoints.map((point) => `- ${point}`).join("\n")}` : "",
		connections(cwd, [...topicConnections(cwd, input.topic), ...(input.links || [])]), "",
	].join("\n");
	saveNote(file, `${prior.trimEnd()}\n\n${update}`);
	return path.relative(cwd, file).replace(/\\/g, "/");
}

export function saveApproachGarage(cwd: string, input: {
	topic: string; approach: string; observedResponse: string; eventIds?: string[]; links?: string[];
}): string {
	if (!input.approach.trim() || !input.observedResponse.trim()) throw new Error("Approach and observed response are required.");
	const file = path.join(garageTopicDir(cwd, input.topic), "approaches", `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.md`);
	const body = ["---", "tags: [learning/garage, learning/approach]", `topic: ${JSON.stringify(input.topic)}`, "---", "",
		`# Teaching approach — ${input.topic}`, "", `Approach: ${input.approach.trim()}`, "",
		`Observed response: ${input.observedResponse.trim()}`, "",
		`Evidence event IDs: ${input.eventIds?.length ? input.eventIds.join(", ") : "none; treat as an observation, not a mastery claim"}`,
		connections(cwd, [...topicConnections(cwd, input.topic), ...(input.links || [])]),
	].join("\n");
	saveNote(file, body);
	return path.relative(cwd, file).replace(/\\/g, "/");
}

export interface LearningOutlier {
	skill: string; eventId: string; score: number; baseline: number; baselineEventIds: string[];
	taskType: string; representation: string; direction: "higher" | "lower";
}

export function findLearningOutliers(events: LearningEventV1[]): LearningOutlier[] {
	const independent = events.filter((event) => event.assistanceState === "none" && event.novelty !== "repeated" && Number.isFinite(event.score));
	const results: LearningOutlier[] = [];
	for (const latest of independent) {
		for (const skill of latest.skillIds) {
			const prior = independent.filter((event) => event.skillIds.includes(skill) && event.taskType === latest.taskType &&
				event.representation === latest.representation && Date.parse(event.submittedAt) < Date.parse(latest.submittedAt))
				.sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)).slice(0, 3);
			if (prior.length < 3) continue;
			const baseline = prior.reduce((sum, event) => sum + event.score, 0) / prior.length;
			if (Math.abs(latest.score - baseline) < 0.4) continue;
			results.push({ skill, eventId: latest.eventId, score: latest.score, baseline,
				baselineEventIds: prior.map((event) => event.eventId), taskType: latest.taskType,
				representation: latest.representation, direction: latest.score > baseline ? "higher" : "lower" });
		}
	}
	return results.slice(-10);
}

export function analyzeAndSaveOutliers(cwd: string, topic: string): LearningOutlier[] {
	const outliers = findLearningOutliers(readLearningEvents(cwd, topic));
	for (const item of outliers) {
		const safeId = item.eventId.replace(/[^a-z0-9-]/gi, "-").slice(0, 100);
		const file = path.join(garageTopicDir(cwd, topic), "outliers", `${safeId}.md`);
		const body = ["---", "tags: [learning/garage, learning/outlier]", `topic: ${JSON.stringify(topic)}`, "---", "",
		`# Candidate performance outlier — ${item.skill}`, "",
		`- Direction: ${item.direction}`, `- Latest score: ${item.score.toFixed(2)}`,
		`- Prior three comparable attempts: ${item.baseline.toFixed(2)} mean`,
		`- Comparison: ${item.taskType}, ${item.representation}, unaided and non-repeated`,
		`- Latest event: ${item.eventId}`, `- Baseline events: ${item.baselineEventIds.join(", ")}`, "",
		"Investigate task difficulty, conditions, and scoring before inferring a cause. This note does not change mastery state.", "",
		].join("\n");
		saveNote(file, body);
	}
	return outliers;
}

export function readGarageContext(cwd: string, topic: string): string | null {
	const root = garageTopicDir(cwd, topic);
	if (!fs.existsSync(root)) return null;
	const files = ([ ["sessions", 1], ["sources", 3], ["approaches", 3], ["outliers", 2] ] as const).flatMap(([group, limit]) => {
		const dir = path.join(root, group);
		return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".md"))
			.map((name) => path.join(dir, name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, limit) : [];
	});
	if (!files.length) return null;
	return files.map((file) => {
		const body = fs.readFileSync(file, "utf-8");
		const excerpt = file.includes(`${path.sep}sources${path.sep}`) && body.length > 1600
			? `${body.slice(0, 400)}\n...\n${body.slice(-1200)}` : body.slice(0, 1600);
		return `Note: ${path.relative(cwd, file).replace(/\\/g, "/")}\n${excerpt}`;
	}).join("\n\n").slice(0, 8000);
}
