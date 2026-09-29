/**
 * web-memorize — Local web tool for interactive memorization, Quizlet Learn, and flashcards.
 *
 * Provides a local, self-contained, responsive web application in the user's
 * default browser featuring:
 *   1. Minimalist Editorial Aesthetic: Monochromatic, high-contrast, clean typography,
 *      hairline borders, light/dark mode toggle.
 *   2. Quizlet Learn Mode: vocabulary-focused, open-ended typed recall in rounds,
 *      with 10-second micro-breaks (Bönstrup consolidation) and temporary session acquisition tracking.
 *      MCQ is deliberately not used as the default memorization path; it belongs in diagnostics.
 *   3. Flashcards (Anki-style): Temporal spaced repetition with FSRS-4 scheduling,
 *      cloze deletions, and instant non-leaking card resets.
 *   4. Live Sync & Pi Handoff: Reports session results back to Pi CLI so the tutor
 *      can immediately run an unassisted CLI verification test.
 *
 * Research basis:
 *   - Active Recall & Testing Effect (Roediger & Karpicke, 2006)
 *   - Generation Effect & Production (Slamecka & Graf, 1978)
 *   - FSRS-4 Spaced Scheduling (Open Spaced Repetition)
 *   - Micro-Offline Consolidation (Bönstrup et al., 2019): 10-second rest
 *     intervals between card rounds to promote hippocampal sharp-wave replay.
 *
 * Tools:
 *   open_memorize_web — compile cards and launch the web Quizlet Learn / flashcard UI
 *   run_review_test   — inspect recent session results and administer terminal verification
 *
 * Commands:
 *   /memorize   — launch web learning tool for due cards or topic
 *   /flashcards — alias for /memorize
 *   /test       — run terminal verification test on recently memorized cards
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as child_process from "node:child_process";
import { applyFsrsReview as applySharedFsrsReview } from "../core/fsrs.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WebCard {
	id: string;
	front: string;
	back: string;
	topic: string;
	skill: string;
	difficulty?: number;
	mnemonic?: string;
	locus?: string;
	hint?: string;
	tags?: string[];
	lastReview?: string;
	nextReview?: string;
	reps?: number;
}

interface StoredCard extends WebCard {
	stability?: number;
	lapses?: number;
	createdAt?: string;
	sourceMode?: string;
	deadline?: string | null;
}

interface CardsFile {
	version: number;
	cards: StoredCard[];
	lastUpdated: string;
}

interface LastSessionData {
	topic: string;
	title: string;
	completedAt: string;
	totalCards: number;
	masteredCount: number;
	roundsCompleted: number;
	lapsedCards: Array<{ id: string; front: string; back: string; attempts: number }>;
	results: Array<{ id: string; front: string; back: string; status: "mastered" | "learning"; attempts: number }>;
}

// ── FSRS-4 math helper for in-server updates ─────────────────────────────────

function applyFsrsReview(card: StoredCard, grade: 1 | 2 | 3 | 4): StoredCard {
	card.difficulty ??= 5;
	card.stability ??= 0;
	card.reps ??= 0;
	card.lapses ??= 0;
	return applySharedFsrsReview(card as StoredCard & { difficulty: number; stability: number; reps: number; lapses: number }, grade);
}

// ── File Helpers ────────────────────────────────────────────────────────────

function getCardsFilePath(cwd: string): string {
	return path.join(cwd, "_learning", "reviews", "cards.json");
}

function getLastSessionFilePath(cwd: string): string {
	return path.join(cwd, "_learning", "reviews", "last-session.json");
}

function loadCardsFile(cwd: string): CardsFile {
	const fp = getCardsFilePath(cwd);
	if (fs.existsSync(fp)) {
		try {
			return JSON.parse(fs.readFileSync(fp, "utf-8"));
		} catch {
			// fallback
		}
	}
	return { version: 1, cards: [], lastUpdated: new Date().toISOString() };
}

function saveCardsFile(cwd: string, data: CardsFile): void {
	const dir = path.join(cwd, "_learning", "reviews");
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	data.lastUpdated = new Date().toISOString();
	fs.writeFileSync(getCardsFilePath(cwd), JSON.stringify(data, null, 2), "utf-8");
}

function saveLastSession(cwd: string, data: LastSessionData): void {
	const dir = path.join(cwd, "_learning", "reviews");
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(getLastSessionFilePath(cwd), JSON.stringify(data, null, 2), "utf-8");
}

function saveDeckToObsidian(cwd: string, topic: string, title: string, mode: string, cards: WebCard[]): string {
	const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "general";
	const dir = path.join(cwd, "content", "exports");
	fs.mkdirSync(dir, { recursive: true });
	const filePath = path.join(dir, `memorize-${slug}.md`);
	const lines = [
		"---",
		"tags: [learning/export, learning/flashcards]",
		`topic: ${JSON.stringify(topic)}`,
		`mode: ${mode}`,
		`updated: ${new Date().toISOString()}`,
		"---",
		"",
		`# ${title}`,
		"",
		"> [!note] Retrieval deck",
		"> Attempt each prompt before revealing its answer. Browser performance is same-session evidence; durable retention requires later retrieval.",
	];
	for (const [index, card] of cards.entries()) {
		lines.push("", `## ${index + 1}. ${card.front}`, "", `> [!answer]- Answer\n> ${card.back.replace(/\n/g, "\n> ")}`);
		if (card.hint) lines.push("", `> [!hint]- Hint\n> ${card.hint.replace(/\n/g, "\n> ")}`);
	}
	fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
	return filePath;
}

function loadLastSession(cwd: string): LastSessionData | null {
	const fp = getLastSessionFilePath(cwd);
	if (fs.existsSync(fp)) {
		try {
			return JSON.parse(fs.readFileSync(fp, "utf-8"));
		} catch {
			return null;
		}
	}
	return null;
}

function getWebDir(cwd: string): string {
	const dir = path.join(cwd, "_learning", "web");
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	return dir;
}

// ── Local HTTP Server ───────────────────────────────────────────────────────

interface ServerState {
	server: http.Server | null;
	port: number;
	cwd: string;
	currentDeck: {
		topic: string;
		title: string;
		mode: string;
		cards: WebCard[];
	};
}

const serverState: ServerState = {
	server: null,
	port: 38472,
	cwd: process.cwd(),
	currentDeck: {
		topic: "General",
		title: "Interactive Learning",
		mode: "learn",
		cards: [],
	},
};

function ensureServerRunning(cwd: string): Promise<number> {
	return new Promise((resolve) => {
		serverState.cwd = cwd;
		if (serverState.server && serverState.server.listening) {
			resolve(serverState.port);
			return;
		}

		const server = http.createServer((req, res) => {
			// The memorizer is a local app; never grant cross-origin access to arbitrary sites.
			res.setHeader("Access-Control-Allow-Origin", `http://127.0.0.1:${serverState.port}`);
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type");

			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			const urlPath = req.url?.split("?")[0] || "/";

			if (urlPath === "/api/deck" && req.method === "GET") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(serverState.currentDeck));
				return;
			}

			if (urlPath === "/api/review" && req.method === "POST") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					try {
						const { cardId, grade } = JSON.parse(body);
						if (!cardId || ![1, 2, 3, 4].includes(grade)) {
							res.writeHead(400, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ error: "Invalid review parameters" }));
							return;
						}

						const cardsData = loadCardsFile(serverState.cwd);
						let target = cardsData.cards.find((c) => c.id === cardId);
						if (!target) {
							const deckCard = serverState.currentDeck.cards.find((c) => c.id === cardId);
							if (deckCard) {
								target = {
									...deckCard,
									difficulty: deckCard.difficulty ?? 5,
									stability: 0,
									createdAt: new Date().toISOString(),
									reps: 0,
									lapses: 0,
								};
								cardsData.cards.push(target);
							}
						}

						if (target) {
							applyFsrsReview(target, grade as 1 | 2 | 3 | 4);
							saveCardsFile(serverState.cwd, cardsData);
							res.writeHead(200, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ success: true, card: target }));
						} else {
							res.writeHead(404, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ error: "Card not found" }));
						}
					} catch (err: any) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: err.message }));
					}
				});
				return;
			}

			if (urlPath === "/api/complete" && req.method === "POST") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					try {
						const sessionData = JSON.parse(body) as LastSessionData;
						saveLastSession(serverState.cwd, sessionData);
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ success: true, message: "Session saved. Ready for Pi CLI verification." }));
					} catch (err: any) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: err.message }));
					}
				});
				return;
			}

			if (urlPath === "/api/last-session" && req.method === "GET") {
				const lastSession = loadLastSession(serverState.cwd);
				if (lastSession) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(lastSession));
				} else {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "No last session recorded" }));
				}
				return;
			}

			if (urlPath === "/api/progress" && req.method === "POST") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					try {
						const progressData = JSON.parse(body);
						const topic = progressData.topic || "default";
						const progressDir = path.join(serverState.cwd, "_learning", "reviews");
						if (!fs.existsSync(progressDir)) fs.mkdirSync(progressDir, { recursive: true });
						const safeTopic = topic.replace(/[^a-zA-Z0-9_-]/g, "_");
						fs.writeFileSync(path.join(progressDir, `progress-${safeTopic}.json`), JSON.stringify(progressData, null, 2), "utf-8");
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ success: true }));
					} catch (err: any) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: err.message }));
					}
				});
				return;
			}

			if (urlPath === "/api/progress" && req.method === "GET") {
				const u = new URL(req.url || "", `http://127.0.0.1:${serverState.port}`);
				const topic = u.searchParams.get("topic") || "default";
				const safeTopic = topic.replace(/[^a-zA-Z0-9_-]/g, "_");
				const filePath = path.join(serverState.cwd, "_learning", "reviews", `progress-${safeTopic}.json`);
				if (fs.existsSync(filePath)) {
					try {
						const data = fs.readFileSync(filePath, "utf-8");
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(data);
						return;
					} catch {}
				}
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "No progress found" }));
				return;
			}

			if (urlPath === "/api/progress" && req.method === "DELETE") {
				const u = new URL(req.url || "", `http://127.0.0.1:${serverState.port}`);
				const topic = u.searchParams.get("topic") || "default";
				const safeTopic = topic.replace(/[^a-zA-Z0-9_-]/g, "_");
				const filePath = path.join(serverState.cwd, "_learning", "reviews", `progress-${safeTopic}.json`);
				if (fs.existsSync(filePath)) {
					try { fs.unlinkSync(filePath); } catch {}
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: true }));
				return;
			}

			if (urlPath === "/" || urlPath === "/index.html" || urlPath === "/memorize.html") {
				const htmlPath = path.join(getWebDir(serverState.cwd), "memorize.html");
				if (fs.existsSync(htmlPath)) {
					const content = fs.readFileSync(htmlPath, "utf-8");
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
					res.end(content);
					return;
				}
			}

			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not Found");
		});

		server.on("error", (err: any) => {
			if (err.code === "EADDRINUSE") {
				server.listen(0, "127.0.0.1", () => {
					const addr = server.address();
					if (addr && typeof addr === "object") {
						serverState.port = addr.port;
						serverState.server = server;
						resolve(serverState.port);
					}
				});
			} else {
				console.error("[web-memorize] Server error:", err);
				resolve(38472);
			}
		});

		server.listen(serverState.port, "127.0.0.1", () => {
			serverState.server = server;
			resolve(serverState.port);
		});
	});
}

function openBrowser(targetUrl: string): void {
	const platform = process.platform;
	try {
		if (platform === "win32") {
			child_process.execFile("cmd.exe", ["/c", "start", "", targetUrl]);
		} else if (platform === "darwin") {
			child_process.execFile("open", [targetUrl]);
		} else {
			child_process.execFile("xdg-open", [targetUrl]);
		}
	} catch (e) {
		console.error("[web-memorize] Failed to open browser:", e);
	}
}

// ── HTML Template Generator (Minimalist Editorial Aesthetic) ─────────────────

function generateMemorizeHtml(deck: {
	topic: string;
	title: string;
	mode: string;
	cards: WebCard[];
}): string {
	const serializedDeck = JSON.stringify(deck).replace(/</g, "\\u003c");
	const cardCount = deck.cards ? deck.cards.length : 0;
	const safeTitle = escapeHtml(deck.title || "Interactive Learning");
	const safeTopic = escapeHtml(deck.topic || "General");

	return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
  :root {
    --bg-canvas: #080808;
    --bg-surface: #111111;
    --bg-elevated: #181818;
    --border-subtle: rgba(255, 255, 255, 0.12);
    --border-strong: rgba(255, 255, 255, 0.28);
    --text-primary: #FFFFFF;
    --text-secondary: #999999;
    --text-muted: #555555;
    --accent: #FFFFFF;
    --status-correct: #22C55E;
    --status-error: #EF4444;
    --font-display: 'Space Grotesk', -apple-system, sans-serif;
    --font-sans: 'Inter', -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }

  [data-theme="light"] {
    --bg-canvas: #F6F6F7;
    --bg-surface: #FFFFFF;
    --bg-elevated: #ECECED;
    --border-subtle: rgba(0, 0, 0, 0.10);
    --border-strong: rgba(0, 0, 0, 0.25);
    --text-primary: #111111;
    --text-secondary: #555555;
    --text-muted: #999999;
    --accent: #111111;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg-canvas);
    color: var(--text-primary);
    font-family: var(--font-sans);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    -webkit-font-smoothing: antialiased;
    transition: background 0.2s ease, color 0.2s ease;
  }

  /* ── Header ── */
  header {
    height: 60px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 32px;
    background: var(--bg-surface);
    position: sticky;
    top: 0;
    z-index: 50;
  }
  .brand-group {
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .brand-title {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 1rem;
    letter-spacing: -0.02em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .brand-sub {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-muted);
    font-weight: 400;
  }
  .nav-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 12px;
  }
  .nav-tab {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.76rem;
    letter-spacing: 0.08em;
    padding: 8px 12px;
    cursor: pointer;
    position: relative;
    transition: all 0.15s ease;
  }
  .nav-tab:hover {
    color: var(--text-secondary);
  }
  .nav-tab.active {
    color: var(--text-primary);
    font-weight: 700;
  }
  .nav-tab.active::after {
    content: "";
    position: absolute;
    bottom: -1px;
    left: 12px;
    right: 12px;
    height: 2px;
    background: var(--text-primary);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .meta-stats {
    display: flex;
    align-items: center;
    gap: 16px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .meta-val {
    color: var(--text-primary);
    font-weight: 600;
  }
  .persisted-badge {
    display: none;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--status-correct);
    letter-spacing: 0.05em;
  }
  .icon-btn {
    background: transparent;
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 6px 12px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .icon-btn:hover {
    border-color: var(--border-strong);
    background: var(--bg-elevated);
  }
  .icon-btn.danger:hover {
    border-color: var(--status-error);
    color: var(--status-error);
  }

  /* ── Layout & Progress ── */
  main {
    flex: 1;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .progress-wrap {
    margin-bottom: 36px;
  }
  .progress-labels {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .progress-track {
    width: 100%;
    height: 4px;
    background: var(--border-subtle);
    position: relative;
    overflow: hidden;
    display: flex;
    border-radius: 2px;
  }
  .progress-fill-mastered {
    height: 100%;
    background: var(--status-correct);
    width: 0%;
    transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .progress-fill-familiar {
    height: 100%;
    background: #F59E0B;
    width: 0%;
    transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .stat-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .stat-dot {
    font-size: 0.65rem;
    line-height: 1;
  }
  .stat-dot.green { color: #22C55E; }
  .stat-dot.amber { color: #F59E0B; }
  .stat-dot.gray { color: var(--text-muted); }
  .mcq-btn.dimmed {
    opacity: 0.3;
    pointer-events: none;
  }

  /* ── Views ── */
  .view-container {
    display: none;
  }
  .view-container.active {
    display: block;
  }

  /* ── Quizlet Learn & Drill Card ── */
  .learn-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 44px 38px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.12);
  }
  .card-top-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 28px;
  }
  .meta-tag {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .meta-tag.highlight {
    color: var(--text-primary);
    font-weight: 700;
  }
  .learn-prompt {
    font-family: var(--font-display);
    font-size: 1.65rem;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: -0.02em;
    margin-bottom: 24px;
  }
  .learn-hint {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 28px;
    display: none;
  }

  /* ── Rapid MCQ ── */
  .mcq-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 24px;
  }
  .mcq-btn {
    background: var(--bg-canvas);
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    padding: 16px 20px;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.95rem;
    line-height: 1.4;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .mcq-btn:hover {
    border-color: var(--border-strong);
    background: var(--bg-elevated);
  }
  .mcq-btn .key-badge {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    padding: 2px 6px;
    border: 1px solid var(--border-subtle);
    border-radius: 2px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .mcq-btn.correct {
    border-color: var(--status-correct);
    background: rgba(34, 197, 94, 0.1);
  }
  .mcq-btn.incorrect {
    border-color: var(--status-error);
    background: rgba(239, 68, 68, 0.1);
  }

  /* ── Open-Ended Typed Answer (Learn & Drill) ── */
  .type-box-wrap {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .type-input {
    width: 100%;
    background: var(--bg-canvas);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    padding: 16px 18px;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 1.05rem;
    outline: none;
    transition: border-color 0.15s ease;
  }
  .type-input:focus {
    border-color: var(--text-primary);
  }
  .type-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
  .btn-primary {
    background: var(--text-primary);
    color: var(--bg-canvas);
    border: none;
    border-radius: 3px;
    padding: 12px 24px;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }
  .btn-primary:hover {
    opacity: 0.9;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    padding: 12px 20px;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-ghost:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .btn-override {
    background: rgba(239, 68, 68, 0.15);
    color: #F87171;
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 3px;
    padding: 10px 18px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-override:hover {
    background: rgba(239, 68, 68, 0.25);
    border-color: #EF4444;
  }

  /* ── Feedback Box ── */
  .feedback-box {
    display: none;
    margin-top: 24px;
    padding: 20px 24px;
    border-radius: 3px;
    border-left: 3px solid transparent;
  }
  .feedback-box.correct {
    background: rgba(34, 197, 94, 0.08);
    border-left-color: var(--status-correct);
    color: var(--status-correct);
  }
  .feedback-box.incorrect {
    background: rgba(239, 68, 68, 0.08);
    border-left-color: var(--status-error);
    color: var(--status-error);
  }
  .diff-text {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    margin-top: 8px;
    color: var(--text-secondary);
    word-break: break-word;
  }

  /* ── Flashcard Stage ── */
  .card-stage {
    perspective: 1200px;
    width: 100%;
    min-height: 380px;
    cursor: pointer;
  }
  .card-inner {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 380px;
    transition: transform 0.4s cubic-bezier(0.2, 0.85, 0.4, 1.2);
    transform-style: preserve-3d;
  }
  .card-inner.is-flipped {
    transform: rotateY(180deg);
  }
  .card-face {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
    padding: 44px 38px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: var(--bg-surface);
  }
  .card-face-back {
    transform: rotateY(180deg);
  }
  .rating-container {
    width: 100%;
    margin-top: 28px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .rating-container.active {
    opacity: 1;
    pointer-events: auto;
  }
  .btn-rate {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    padding: 12px 10px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    transition: all 0.15s ease;
  }
  .btn-rate:hover {
    border-color: var(--text-primary);
    background: var(--bg-elevated);
  }

  /* ── Micro-Rest / Break Modal ── */
  .rest-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.88);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .rest-modal-overlay.active {
    opacity: 1;
    pointer-events: auto;
  }
  .rest-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    max-width: 440px;
    width: 90%;
    padding: 40px 32px;
    text-align: center;
  }
  .countdown-digits {
    font-family: var(--font-mono);
    font-size: 4.2rem;
    font-weight: 800;
    letter-spacing: -0.05em;
    margin: 20px 0;
    color: var(--text-primary);
  }

  /* ── Completion Screen ── */
  .completion-screen {
    display: none;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 56px 40px;
    text-align: center;
  }
  .completion-screen.active {
    display: block;
  }

  /* ── Stage Transition Notice ── */
  .stage-transition-box {
    display: none;
    text-align: center;
    padding: 36px 20px;
  }

  /* ── Cloze markup ── */
  .cloze-target {
    border-bottom: 2px solid var(--status-correct);
    color: var(--status-correct);
    font-weight: 700;
    padding: 0 4px;
  }
  .cloze-occlusion {
    border-bottom: 1px dashed var(--text-secondary);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    padding: 0 6px;
  }
  /* ── Minimal AI Study Platform theme ── */
  :root,
  [data-theme="light"] {
    color-scheme: light;
    --bg-canvas: #FAF9F6;
    --bg-surface: #FFFFFF;
    --bg-elevated: #F4F3EF;
    --border-subtle: #E4E2DC;
    --border-strong: #C9C6BE;
    --text-primary: #18181B;
    --text-secondary: #3F3F46;
    --text-muted: #71717A;
    --accent: #4F46E5;
    --accent-hover: #4338CA;
    --accent-soft: #EEEDFF;
    --status-correct: #0D9488;
    --status-correct-soft: #E7F7F4;
    --status-error: #DC4753;
    --status-error-soft: #FDECEF;
    --status-familiar: #B7791F;
    --font-display: 'Newsreader', Georgia, serif;
    --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, monospace;
    --shadow-card: 0 1px 2px rgba(24, 24, 27, 0.04), 0 12px 36px rgba(24, 24, 27, 0.06);
    --shadow-float: 0 24px 64px rgba(24, 24, 27, 0.14);
  }

  [data-theme="dark"] {
    color-scheme: dark;
    --bg-canvas: #171719;
    --bg-surface: #222225;
    --bg-elevated: #2B2B2F;
    --border-subtle: #38383D;
    --border-strong: #52525B;
    --text-primary: #FAFAF9;
    --text-secondary: #D4D4D8;
    --text-muted: #A1A1AA;
    --accent: #8B83FF;
    --accent-hover: #A59FFF;
    --accent-soft: #302E50;
    --status-correct: #2DD4BF;
    --status-correct-soft: #173C38;
    --status-error: #FB7185;
    --status-error-soft: #48252C;
    --status-familiar: #F3B95F;
    --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.2), 0 16px 42px rgba(0, 0, 0, 0.24);
    --shadow-float: 0 28px 72px rgba(0, 0, 0, 0.42);
  }

  html { scroll-behavior: smooth; }
  body {
    min-height: 100dvh;
    line-height: 1.5;
  }
  button,
  input { font: inherit; }
  button { touch-action: manipulation; }
  button:focus-visible,
  input:focus-visible,
  [tabindex]:focus-visible,
  .card-stage:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--accent) 28%, transparent);
    outline-offset: 3px;
  }

  header {
    min-height: 72px;
    height: auto;
    padding: 12px clamp(16px, 3vw, 40px);
    gap: 24px;
    background: color-mix(in srgb, var(--bg-canvas) 92%, transparent);
    border-color: var(--border-subtle);
    backdrop-filter: blur(16px);
    box-shadow: 0 1px 0 rgba(24, 24, 27, 0.02);
  }
  .brand-group { gap: 20px; min-width: 0; }
  .brand-title {
    gap: 10px;
    font-family: var(--font-sans);
    font-size: 0.84rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .brand-title::before {
    content: '';
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .brand-sub {
    max-width: 22ch;
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0;
    text-overflow: ellipsis;
  }
  .nav-tabs {
    gap: 4px;
    margin-left: 4px;
    padding: 4px;
    border-radius: 8px;
    background: var(--bg-elevated);
  }
  .nav-tab {
    min-height: 36px;
    padding: 8px 12px;
    border-radius: 4px;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .nav-tab:hover { color: var(--text-primary); background: color-mix(in srgb, var(--bg-surface) 64%, transparent); }
  .nav-tab.active { color: var(--text-primary); background: var(--bg-surface); box-shadow: 0 1px 3px rgba(24, 24, 27, 0.08); }
  .nav-tab.active::after { display: none; }
  .header-actions { gap: 8px; }
  .meta-stats {
    gap: 12px;
    margin-right: 4px;
    font-family: var(--font-sans);
    font-size: 0.68rem;
    font-weight: 500;
  }
  .persisted-badge { font-family: var(--font-sans); font-weight: 600; }
  .stat-dot.green { color: var(--status-correct); }
  .stat-dot.amber { color: var(--status-familiar); }
  .icon-btn,
  .btn-primary,
  .btn-ghost,
  .btn-override,
  .btn-rate {
    border-radius: 4px;
    font-family: var(--font-sans);
    transition: color 160ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
  }
  .icon-btn {
    min-height: 36px;
    padding: 7px 10px;
    background: var(--bg-surface);
    border-color: var(--border-subtle);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: none;
  }
  .icon-btn:hover { background: var(--bg-elevated); border-color: var(--border-strong); }
  .icon-btn:active,
  .btn-primary:active,
  .btn-ghost:active,
  .btn-override:active,
  .btn-rate:active,
  .mcq-btn:active { transform: translateY(1px); }

  main {
    max-width: 860px;
    min-height: calc(100dvh - 72px);
    padding: clamp(40px, 7vh, 80px) clamp(16px, 4vw, 32px) clamp(64px, 9vh, 104px);
  }
  .progress-wrap { margin-bottom: 24px; }
  .progress-labels {
    margin-bottom: 10px;
    font-family: var(--font-sans);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .progress-track { height: 6px; border-radius: 4px; background: var(--bg-elevated); }
  .progress-fill-mastered { background: var(--status-correct); }
  .progress-fill-familiar { background: var(--status-familiar); }

  .learn-card,
  .card-face,
  .completion-screen {
    border-color: var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-surface);
    box-shadow: var(--shadow-card);
  }
  .learn-card { padding: clamp(28px, 5vw, 52px); }
  .card-top-meta { margin-bottom: clamp(24px, 4vw, 36px); }
  .meta-tag {
    font-family: var(--font-sans);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.06em;
  }
  .meta-tag.highlight { color: var(--accent); }
  .learn-prompt {
    max-width: 64ch;
    margin-bottom: 28px;
    font-size: clamp(1.8rem, 4vw, 2.45rem);
    font-weight: 600;
    line-height: 1.16;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }
  .learn-hint {
    max-width: 68ch;
    margin-bottom: 28px;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.86rem;
    line-height: 1.65;
  }
  .mcq-grid { gap: 8px; }
  .mcq-btn {
    min-height: 72px;
    padding: 16px;
    border-color: var(--border-subtle);
    border-radius: 4px;
    background: var(--bg-elevated);
    font-size: 0.92rem;
    font-weight: 500;
    line-height: 1.5;
  }
  .mcq-btn:hover { background: var(--bg-surface); border-color: var(--accent); box-shadow: 0 4px 16px rgba(79, 70, 229, 0.08); }
  .mcq-btn .key-badge { border-radius: 4px; background: var(--bg-surface); }
  .mcq-btn.correct { background: var(--status-correct-soft); border-color: var(--status-correct); }
  .mcq-btn.incorrect { background: var(--status-error-soft); border-color: var(--status-error); }

  .type-box-wrap { gap: 12px; }
  .type-input {
    min-height: 52px;
    padding: 14px 16px;
    border-color: var(--border-strong);
    border-radius: 4px;
    background: var(--bg-canvas);
    font-size: 1rem;
  }
  .type-input::placeholder { color: var(--text-muted); }
  .type-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
  .type-actions { gap: 8px; }
  .btn-primary,
  .btn-ghost { min-height: 44px; padding: 11px 18px; font-size: 0.75rem; letter-spacing: 0.02em; text-transform: none; }
  .btn-primary { background: var(--accent); color: #FFFFFF; box-shadow: 0 1px 2px rgba(79, 70, 229, 0.24); }
  .btn-primary:hover { background: var(--accent-hover); opacity: 1; box-shadow: 0 6px 18px rgba(79, 70, 229, 0.18); }
  .btn-ghost { background: var(--bg-surface); color: var(--text-secondary); border-color: var(--border-subtle); }
  .btn-ghost:hover { background: var(--bg-elevated); border-color: var(--border-strong); color: var(--text-primary); }
  .btn-override { border-radius: 4px; font-family: var(--font-sans); letter-spacing: 0.02em; text-transform: none; }
  .feedback-box { padding: 20px 24px; border-radius: 4px; }
  .feedback-box.correct { background: var(--status-correct-soft); }
  .feedback-box.incorrect { background: var(--status-error-soft); }
  .diff-text { max-width: 68ch; font-family: var(--font-sans); line-height: 1.6; }

  .card-stage,
  .card-inner { min-height: clamp(360px, 52vh, 460px); }
  .card-face { padding: clamp(28px, 5vw, 52px); }
  .card-face > div:nth-child(2) { max-width: 64ch; font-size: clamp(1.8rem, 4vw, 2.35rem) !important; font-weight: 600 !important; line-height: 1.2 !important; text-wrap: balance; }
  .rating-container { margin-top: 16px; gap: 8px; }
  .btn-rate { min-height: 58px; background: var(--bg-surface); border-color: var(--border-subtle); font-size: 0.72rem; letter-spacing: 0.03em; }
  .btn-rate:hover { background: var(--bg-elevated); border-color: var(--accent); }

  .rest-modal-overlay { padding: 20px; background: color-mix(in srgb, var(--text-primary) 42%, transparent); backdrop-filter: blur(12px); }
  .rest-card {
    width: min(100%, 520px) !important;
    max-width: 520px !important;
    padding: clamp(28px, 5vw, 40px);
    border-color: var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-surface);
    box-shadow: var(--shadow-float);
  }
  .countdown-digits { color: var(--accent); font-family: var(--font-sans); }
  .completion-screen { padding: clamp(40px, 7vw, 64px) clamp(24px, 5vw, 48px); }
  .completion-screen p,
  .stage-transition-box p,
  #rest-modal-desc { max-width: 62ch !important; line-height: 1.7 !important; }
  .stage-transition-box { padding: 40px 16px; }
  .cloze-target { color: var(--status-correct); border-color: var(--status-correct); }

  @media (max-width: 1050px) {
    header { align-items: flex-start; flex-wrap: wrap; }
    .brand-group { width: 100%; justify-content: space-between; }
    .header-actions { width: 100%; flex-wrap: wrap; }
    .meta-stats { flex: 1 1 100%; justify-content: space-between; order: 2; margin: 2px 0 0; }
  }
  @media (max-width: 680px) {
    header { position: relative; gap: 10px; padding: 12px; }
    .brand-group { align-items: flex-start; flex-direction: column; gap: 10px; }
    .brand-title { width: 100%; white-space: normal; }
    .brand-sub { margin-left: auto; max-width: 48%; }
    .nav-tabs { width: 100%; margin: 0; }
    .nav-tab { flex: 1; padding-inline: 6px; }
    .header-actions { gap: 6px; }
    .meta-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 12px; }
    .persisted-badge { width: 100%; }
    .icon-btn { flex: 1; }
    main { min-height: auto; justify-content: flex-start; padding-top: 36px; }
    .progress-labels { gap: 16px; }
    .progress-labels span:last-child { text-align: right; }
    .learn-card { padding: 28px 20px; }
    .mcq-grid { grid-template-columns: 1fr; }
    .type-actions { align-items: stretch; flex-direction: column-reverse; }
    .type-actions button { width: 100%; }
    .card-stage,
    .card-inner { min-height: 400px; }
    .card-face { padding: 28px 22px; }
    .rating-container { grid-template-columns: repeat(2, 1fr); }
    .round-summary-grid { grid-template-columns: 1fr !important; }
    .rest-card > div:last-child { align-items: stretch !important; flex-direction: column; }
    .rest-card .btn-primary { width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  }
</style>
</head>
<body>

<header>
  <div class="brand-group">
    <div class="brand-title">
      LEARN // ENGINE
      <span class="brand-sub">I* ${safeTopic}</span>
    </div>
    <div class="nav-tabs">
      <button class="nav-tab active" id="tab-learn" onclick="switchMode('learn')">I* LEARN</button>
      <button class="nav-tab" id="tab-flashcards" onclick="switchMode('flashcards')">II* FLASHCARDS</button>
      <button class="nav-tab" id="tab-drill" onclick="switchMode('drill')">III* DRILL</button>
    </div>
  </div>
  <div class="header-actions">
    <div class="persisted-badge" id="persisted-badge">
      <span>● RESTORED</span>
    </div>
    <div class="meta-stats">
      <span class="stat-pill"><span class="stat-dot green">●</span> <span id="stat-mode-label">ACQUIRED</span>: <span class="meta-val" id="stat-mastered">0</span></span>
      <span class="stat-pill"><span class="stat-dot amber">●</span> FAMILIAR: <span class="meta-val" id="stat-familiar">0</span></span>
      <span class="stat-pill"><span class="stat-dot gray">●</span> REMAINING: <span class="meta-val" id="stat-remaining">${cardCount}</span></span>
      <span id="stat-round-wrap">ROUND: <span class="meta-val" id="stat-round">1</span></span>
    </div>
    <button class="icon-btn danger" id="reset-btn" onclick="promptResetProgress()" title="Restart progress for this deck">Reset</button>
    <button class="icon-btn" id="theme-toggle" onclick="toggleTheme()">☼ Light</button>
    <button class="icon-btn" id="sound-toggle" onclick="toggleSound()">Vol: On</button>
  </div>
</header>

<main>
  <div class="progress-wrap">
    <div class="progress-labels">
      <span id="progress-round-label">ROUND 1 • ITEM 1 OF 12</span>
      <span id="progress-percent">0% ACQUIRED</span>
    </div>
    <div class="progress-track">
      <div class="progress-fill-mastered" id="progress-fill-mastered" style="width: 0%;"></div>
      <div class="progress-fill-familiar" id="progress-fill-familiar" style="width: 0%;"></div>
    </div>
  </div>

  <!-- ── 1. QUIZLET LEARN & DRILL VIEW ── -->
  <div class="view-container active" id="view-learn">
    <div class="learn-card" id="learn-card">
      <div class="card-top-meta">
        <span class="meta-tag" id="question-type-badge">TYPED RECALL</span>
        <span class="meta-tag" id="round-indicator">ROUND 1</span>
      </div>

      <div class="learn-prompt" id="learn-prompt">Loading question...</div>
      <div class="learn-hint" id="learn-hint"></div>

      <!-- Reserved diagnostic options; vocabulary mode uses typed recall -->
      <div id="mcq-section" style="display: none; margin-top: 24px;">
        <div class="mcq-grid" id="mcq-options-container" style="margin-top: 0;">
          <!-- Rendered by JS -->
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: 14px;">
          <button class="btn-ghost" id="mcq-dont-know-btn" onclick="handleDontKnow()">Don't Know [Esc]</button>
        </div>
      </div>

      <!-- Open-Ended Typed Answer (Level 1 & Drill Written Round) -->
      <div class="type-box-wrap" id="type-box-container" style="display: none;">
        <input type="text" class="type-input" id="typed-answer-input" placeholder="Type answer here..." autocomplete="off" />
        <div class="type-actions">
          <button class="btn-ghost" onclick="handleDontKnow()">Don't Know [Esc]</button>
          <button class="btn-primary" onclick="submitTypedAnswer()">Submit [Enter]</button>
        </div>
      </div>

      <!-- Stage Transition Notice (When Learn mode finishes all items) -->
      <div class="stage-transition-box" id="stage-transition-box">
        <div class="meta-tag highlight" style="margin-bottom: 12px; color: var(--status-correct);">CORE RECOGNITION &amp; RECALL ACQUIRED</div>
        <h3 style="font-family: var(--font-display); font-size: 1.55rem; font-weight: 700; margin-bottom: 12px;">Same-Session Acquisition Complete</h3>
        <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto 24px; font-size: 0.95rem; line-height: 1.5;">
          You generated every card in typed recall. Transferring directly into <strong>III* DRILL</strong> to manually write definitions from memory.
        </p>
        <button class="btn-primary" onclick="switchMode('drill')">Enter Drill Mode (III* DRILL) &rarr;</button>
      </div>

      <!-- Feedback / Remediation (Knowt-Style Reinforcement) -->
      <div class="feedback-box" id="learn-feedback">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <span class="meta-tag" id="feedback-badge" style="font-size: 0.7rem; color: var(--status-error);">STUDY THIS ONE</span>
        </div>
        <div id="feedback-message" style="font-weight: 700; font-family: var(--font-display); font-size: 1.25rem;"></div>
        <div class="diff-text" id="feedback-diff"></div>

        <div id="reinforce-copy-box" style="display: none; margin-top: 14px;">
          <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.06em;">
            TYPE TARGET TO REINFORCE (OR PRESS SPACE / ENTER):
          </div>
          <input type="text" class="type-input" id="reinforce-copy-input" placeholder="Type correct answer..." style="padding: 10px 14px; font-size: 0.95rem;" autocomplete="off" oninput="checkReinforceInput(this.value)" />
        </div>

        <div style="display: flex; gap: 12px; align-items: center; margin-top: 14px; flex-wrap: wrap;">
          <button class="btn-primary" id="feedback-continue-btn" onclick="advanceQuestion()">Continue [Space / Enter]</button>
          <button class="btn-override" id="feedback-override-btn" style="display: none;" onclick="overrideAsCorrect()">Override: I Was Right [O]</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ── 2. FLASHCARD VIEW (Anki-style, Zero-Leak) ── -->
  <div class="view-container" id="view-flashcards">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
      <span class="meta-tag" id="flashcard-status-label" style="font-family: var(--font-mono);">CARD 1 OF ${cardCount} (DECK ORDER)</span>
      <div style="display: flex; gap: 8px;">
        <button class="icon-btn" id="flashcard-shuffle-btn" onclick="toggleFlashcardShuffle()" title="Toggle Shuffle (Randomize order) [S]">⤮ Shuffle: Off [S]</button>
      </div>
    </div>
    <div class="card-stage" id="card-stage" onclick="toggleFlashcardFlip()">
      <div class="card-inner" id="card-inner">
        <!-- Front -->
        <div class="card-face card-face-front">
          <div style="display: flex; justify-content: space-between;">
            <span class="meta-tag">PROMPT</span>
            <span class="meta-tag" id="flashcard-num-front">#1</span>
          </div>
          <div style="font-family: var(--font-display); font-size: 1.65rem; font-weight: 700; margin: auto 0; line-height: 1.35;" id="flashcard-front-text">Front text</div>
          <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); text-align: center; letter-spacing: 0.1em;">PRESS SPACE OR CLICK TO REVEAL</div>
        </div>
        <!-- Back -->
        <div class="card-face card-face-back">
          <div style="display: flex; justify-content: space-between;">
            <span class="meta-tag" style="color: var(--status-correct);">ANSWER</span>
            <span class="meta-tag" id="flashcard-num-back">#1</span>
          </div>
          <div style="font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; margin: auto 0; line-height: 1.4;" id="flashcard-back-text"></div>
          <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); text-align: center; letter-spacing: 0.1em;">RATE RECALL DIFFICULTY BELOW</div>
        </div>
      </div>
    </div>

    <div class="rating-container" id="flashcard-rating-container">
      <button class="btn-rate" onclick="submitFlashcardReview(1)">
        <span>[1] AGAIN</span><span style="font-size: 0.68rem; color: var(--text-muted);">&lt;10m</span>
      </button>
      <button class="btn-rate" onclick="submitFlashcardReview(2)">
        <span>[2] HARD</span><span style="font-size: 0.68rem; color: var(--text-muted);">1d</span>
      </button>
      <button class="btn-rate" onclick="submitFlashcardReview(3)">
        <span>[3] GOOD</span><span style="font-size: 0.68rem; color: var(--text-muted);">3d</span>
      </button>
      <button class="btn-rate" onclick="submitFlashcardReview(4)">
        <span>[4] EASY</span><span style="font-size: 0.68rem; color: var(--text-muted);">7d</span>
      </button>
    </div>
  </div>

  <!-- ── 3. ROUND MICRO-REST / BREAK MODAL (Knowt Round Summary) ── -->
  <div class="rest-modal-overlay" id="rest-modal">
    <div class="rest-card" style="max-width: 480px; text-align: left;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <span class="meta-tag highlight" id="rest-modal-tag" style="letter-spacing: 0.12em;">ROUND SUMMARY</span>
        <span class="meta-tag" id="rest-round-num" style="font-family: var(--font-mono);">ROUND 1</span>
      </div>
      
      <h3 style="font-family: var(--font-display); font-size: 1.45rem; font-weight: 800; margin-bottom: 16px;" id="rest-headline">Great job! Round Complete.</h3>
      
      <div class="round-summary-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;">
        <div style="background: var(--bg-elevated); padding: 12px; border-radius: 4px; border: 1px solid var(--border-subtle); text-align: center;">
          <div style="font-size: 1.4rem; font-weight: 800; color: #22C55E; font-family: var(--font-mono);" id="summary-mastered">0</div>
          <div style="font-size: 0.68rem; color: var(--text-secondary); font-family: var(--font-mono); letter-spacing: 0.05em; margin-top: 4px;">MASTERED</div>
        </div>
        <div style="background: var(--bg-elevated); padding: 12px; border-radius: 4px; border: 1px solid var(--border-subtle); text-align: center;">
          <div style="font-size: 1.4rem; font-weight: 800; color: #F59E0B; font-family: var(--font-mono);" id="summary-familiar">0</div>
          <div style="font-size: 0.68rem; color: var(--text-secondary); font-family: var(--font-mono); letter-spacing: 0.05em; margin-top: 4px;">FAMILIAR</div>
        </div>
        <div style="background: var(--bg-elevated); padding: 12px; border-radius: 4px; border: 1px solid var(--border-subtle); text-align: center;">
          <div style="font-size: 1.4rem; font-weight: 800; color: var(--text-muted); font-family: var(--font-mono);" id="summary-remaining">0</div>
          <div style="font-size: 0.68rem; color: var(--text-secondary); font-family: var(--font-mono); letter-spacing: 0.05em; margin-top: 4px;">REMAINING</div>
        </div>
      </div>

      <p id="rest-modal-desc" style="color: var(--text-secondary); font-size: 0.85rem; line-height: 1.5; margin-bottom: 18px;">
        Bönstrup et al. (2019): Resting for a few seconds allows neural replay of memory traces in the hippocampus.
      </p>

      <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); letter-spacing: 0.05em;">AUTO-RESUME IN</span>
          <span class="countdown-digits" id="rest-countdown" style="font-size: 1.25rem; margin: 0; font-weight: 700; color: var(--text-primary);">10s</span>
        </div>
        <button class="btn-primary" onclick="closeMicroRest()">Next Round &rarr; [Space / Enter]</button>
      </div>
    </div>
  </div>

  <!-- ── 4. COMPLETION SCREEN ── -->
  <div class="completion-screen" id="completion-screen">
    <div class="meta-tag" style="margin-bottom: 12px; color: var(--status-correct); letter-spacing: 0.15em;">PRACTICE CYCLE COMPLETE</div>
    <h2 style="font-family: var(--font-display); font-size: 2.2rem; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 14px;">All Items Independently Produced</h2>
    <p style="color: var(--text-secondary); max-width: 520px; margin: 0 auto 28px; font-size: 0.95rem; line-height: 1.5;">
      Every concept was recognized, recalled, and independently produced in this session. This is acquisition evidence; delayed retrieval and changed-context transfer are still required for mastery.
    </p>
    <div style="display: flex; gap: 14px; justify-content: center; flex-wrap: wrap;">
      <button class="btn-primary" onclick="notifyPiCliTest()">Run Pi CLI Verification Test</button>
      <button class="btn-ghost" onclick="restartPractice()">Restart Practice</button>
    </div>
    <div id="cli-test-status" style="margin-top: 18px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--status-correct); display: none;">
      ✓ Session stats synced. Switch back to your Pi terminal to test with your tutor!
    </div>
  </div>
</main>

<script>
  const deckData = ${serializedDeck};
  const allCards = deckData.cards || [];
  let currentMode = "learn";
  if (window.location.hash === "#drill" || deckData.mode === "drill") {
    currentMode = "drill";
  } else if (window.location.hash === "#flashcards" || deckData.mode === "flashcards") {
    currentMode = "flashcards";
  }
  let soundEnabled = true;

  let audioCtx = null;
  function playTone(freq, duration, type = "sine") {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch(e) {}
  }

  function parseCloze(text, reveal = false) {
    if (!text) return "";
    return text.replace(/\\{\\{c(\\d+)::(.*?)(?:::([^}]+))?\\}\\}/g, (match, num, answer, hint) => {
      if (reveal) {
        return '<span class="cloze-target">' + answer + '</span>';
      } else {
        return '<span class="cloze-occlusion">[' + (hint || '...') + ']</span>';
      }
    });
  }

  const STORAGE_KEY = "quizlet_learn_progress_" + (deckData.topic || "default");

  // Single shared card mastery store (Single Source of Truth)
  const sharedCards = allCards.map(c => ({
    ...c,
    level: 0,        // 0: new, 1: familiar, 2: mastered in typed recall
    drillPassed: false, // true once written definition passed in drill
    attempts: 0,
    lapsed: false,
  }));

  // Sync helper: guarantees updates to any card are immediately written to sharedCards
  function syncCard(id, updates) {
    const card = sharedCards.find(c => c.id === id);
    if (card) {
      Object.assign(card, updates);
    }
    return card;
  }

  const learnState = {
    roundQueue: [],
    currentQueueIndex: 0,
    roundNumber: 1,
    waitingForFeedback: false,
    isTransitioning: false,
    isInitialized: false,
  };

  const drillState = {
    roundQueue: [],
    currentQueueIndex: 0,
    roundNumber: 1,
    waitingForFeedback: false,
    isTransitioning: false,
    isInitialized: false,
    writtenCountSinceMcqBreak: 0,
  };

  function loadPersistedProgress() {
    try {
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) {
        applyParsedProgress(JSON.parse(local));
      }
      fetch("/api/progress?topic=" + encodeURIComponent(deckData.topic || "default"))
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            applyParsedProgress(data);
            updateMasteryStats();
          }
        })
        .catch(() => {});
    } catch(e) {}
  }

  function applyParsedProgress(parsed) {
    if (!parsed || !Array.isArray(parsed.cards)) return false;
    try {
      let hasActive = false;
      parsed.cards.forEach(savedCard => {
        const target = sharedCards.find(c => c.id === savedCard.id || c.front === savedCard.front);
        if (target) {
          target.level = savedCard.level ?? 0;
          target.attempts = savedCard.attempts ?? 0;
          target.lapsed = savedCard.lapsed ?? false;
          target.drillPassed = savedCard.drillPassed ?? savedCard.finalWritten ?? false;
          if (target.level > 0 || target.drillPassed) hasActive = true;
        }
      });

      if (parsed.learnRound) learnState.roundNumber = parsed.learnRound;
      else if (parsed.roundNumber && !parsed.isFinalPhase) learnState.roundNumber = parsed.roundNumber;

      if (parsed.drillRound) drillState.roundNumber = parsed.drillRound;

      if (hasActive) {
        document.getElementById("persisted-badge").style.display = "flex";
      }
      return true;
    } catch(e) {
      return false;
    }
  }

  function persistProgress() {
    try {
      const payload = {
        topic: deckData.topic,
        currentMode,
        learnRound: learnState.roundNumber,
        drillRound: drillState.roundNumber,
        savedAt: new Date().toISOString(),
        cards: sharedCards.map(c => ({
          id: c.id,
          front: c.front,
          level: c.level,
          drillPassed: c.drillPassed,
          attempts: c.attempts,
          lapsed: c.lapsed,
        }))
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch(e) {}
  }

  function restartPractice() {
    localStorage.removeItem(STORAGE_KEY);
    fetch("/api/progress?topic=" + encodeURIComponent(deckData.topic || "default"), {
      method: "DELETE"
    }).catch(() => {});

    sharedCards.forEach(c => {
      c.level = 0;
      c.attempts = 0;
      c.lapsed = false;
      c.drillPassed = false;
    });

    learnState.roundNumber = 1;
    learnState.isInitialized = false;
    learnState.waitingForFeedback = false;
    learnState.isTransitioning = false;
    learnState.roundQueue = [];

    drillState.roundNumber = 1;
    drillState.isInitialized = false;
    drillState.waitingForFeedback = false;
    drillState.isTransitioning = false;
    drillState.roundQueue = [];
    drillState.writtenCountSinceMcqBreak = 0;

    document.getElementById("persisted-badge").style.display = "none";
    document.getElementById("completion-screen").classList.remove("active");
    document.getElementById("stage-transition-box").style.display = "none";
    document.getElementById("view-learn").style.display = "";

    if (currentMode === "drill") {
      initDrillRound();
    } else {
      initLearnRound();
    }
  }

  function promptResetProgress() {
    if (confirm("Reset learning progress for this deck? All items will return to Round 1 (Level 0).")) {
      restartPractice();
    }
  }

  // ── Mode Switching & Mastery Transfer ──
  function switchMode(mode) {
    currentMode = mode;
    document.getElementById("tab-learn").classList.toggle("active", mode === "learn");
    document.getElementById("tab-flashcards").classList.toggle("active", mode === "flashcards");
    document.getElementById("tab-drill").classList.toggle("active", mode === "drill");

    const viewLearn = document.getElementById("view-learn");
    viewLearn.style.display = "";
    viewLearn.classList.toggle("active", mode === "learn" || mode === "drill");

    const viewFc = document.getElementById("view-flashcards");
    viewFc.classList.toggle("active", mode === "flashcards");

    document.getElementById("completion-screen").classList.remove("active");

    if (mode === "learn") {
      document.getElementById("stat-mode-label").innerText = "MASTERED";
      if (!learnState.isInitialized || learnState.roundQueue.length === 0) {
        initLearnRound();
      } else {
        renderLearnQuestion();
      }
    } else if (mode === "drill") {
      document.getElementById("stat-mode-label").innerText = "DRILLED";
      if (!drillState.isInitialized || drillState.roundQueue.length === 0) {
        initDrillRound();
      } else {
        renderDrillQuestion();
      }
    } else if (mode === "flashcards") {
      renderFlashcard();
    }
    updateMasteryStats();
  }

  // ── SMART ROUND SIZING (Dynamic & Tail-Absorbing) ──
  function computeSmartRoundSize(totalDeckSize, remainingCount, isDrill = false) {
    let target = 8;
    if (totalDeckSize <= 8) {
      target = totalDeckSize;
    } else if (totalDeckSize <= 20) {
      target = Math.max(8, Math.ceil(totalDeckSize / 2));
    } else if (totalDeckSize <= 38) {
      target = 11;
    } else if (totalDeckSize <= 60) {
      target = 13;
    } else {
      target = 15;
    }

    if (isDrill && target > 10) {
      target = 10;
    }

    // Tail absorption: avoid leaving 1-3 orphan items at the end
    if (remainingCount <= target + 3) {
      return remainingCount;
    }
    return target;
  }

  // ── LEARN MODE ENGINE (Balanced Progression: New Cards + Review) ──
  function initLearnRound() {
    const unmastered = sharedCards.filter(c => c.level < 2);

    if (unmastered.length === 0) {
      // All items mastered in recall! Present transfer to drill mode
      document.getElementById("learn-prompt").style.display = "none";
      document.getElementById("learn-hint").style.display = "none";
      document.getElementById("mcq-options-container").style.display = "none";
      document.getElementById("type-box-container").style.display = "none";
      document.getElementById("learn-feedback").style.display = "none";
      document.getElementById("stage-transition-box").style.display = "block";
      updateMasteryStats();
      return;
    }

    document.getElementById("stage-transition-box").style.display = "none";
    document.getElementById("learn-prompt").style.display = "block";

    const roundSize = computeSmartRoundSize(sharedCards.length, unmastered.length, false);

    // Clear round-level retest flags
    sharedCards.forEach(c => { delete c._retestedInRound; });

    // Balanced selection: Prioritize introducing new terms (level 0) so the learner
    // experiences the entire deck, alongside reinforcing familiar terms (level 1).
    const unstarted = unmastered.filter(c => c.level === 0);
    const inProgress = unmastered.filter(c => c.level === 1);
    shuffleArray(unstarted);
    shuffleArray(inProgress);

    let batch = [];
    if (unstarted.length > 0 && inProgress.length > 0) {
      // Balance new and review items while keeping every prompt production-based.
      const targetNew = Math.min(unstarted.length, Math.max(4, Math.ceil(roundSize * 0.6)));
      const targetReview = Math.min(inProgress.length, roundSize - targetNew);
      batch = [...unstarted.slice(0, targetNew), ...inProgress.slice(0, targetReview)];

      // If still under roundSize, fill with remaining unstarted or inProgress
      if (batch.length < roundSize) {
        const extraUnstarted = unstarted.slice(targetNew);
        const extraInProgress = inProgress.slice(targetReview);
        const needed = roundSize - batch.length;
        batch.push(...[...extraUnstarted, ...extraInProgress].slice(0, needed));
      }
    } else if (unstarted.length > 0) {
      batch = unstarted.slice(0, roundSize);
    } else {
      batch = inProgress.slice(0, roundSize);
    }

    shuffleArray(batch); // Randomize presentation sequence within the round

    // Direct reference to sharedCards items
    learnState.roundQueue = batch;
    learnState.currentQueueIndex = 0;
    learnState.waitingForFeedback = false;
    learnState.isTransitioning = false;
    learnState.isInitialized = true;

    updateMasteryStats();
    renderLearnQuestion();
  }

  function renderLearnQuestion() {
    if (!learnState.isInitialized || learnState.roundQueue.length === 0) {
      initLearnRound();
      return;
    }

    if (learnState.currentQueueIndex >= learnState.roundQueue.length) {
      triggerRoundBreak();
      return;
    }

    learnState.waitingForFeedback = false;
    learnState.isTransitioning = false;
    document.getElementById("learn-feedback").style.display = "none";
    const overrideBtn = document.getElementById("feedback-override-btn");
    if (overrideBtn) overrideBtn.style.display = "none";

    const item = learnState.roundQueue[learnState.currentQueueIndex];
    document.getElementById("learn-prompt").innerHTML = parseCloze(item.front, false);

    const hintEl = document.getElementById("learn-hint");
    if (item.hint) {
      hintEl.innerText = "Hint: " + item.hint;
      hintEl.style.display = "block";
    } else {
      hintEl.style.display = "none";
    }

    const mcqSection = document.getElementById("mcq-section");
    const mcqContainer = document.getElementById("mcq-options-container");
    const typeContainer = document.getElementById("type-box-container");
    const badge = document.getElementById("question-type-badge");

    // Vocabulary memorization must require generation, not recognition.
    // Difficult MCQs belong in separate diagnostic/assessment activities.
    const isMcq = false;

    if (isMcq) {
      badge.innerText = "RAPID MCQ";
      badge.classList.remove("highlight");
      mcqSection.style.display = "block";
      mcqContainer.style.display = "grid";
      typeContainer.style.display = "none";

      const otherAnswers = Array.from(new Set(
        sharedCards
          .filter(c => c.id !== item.id && c.back.trim().toLowerCase() !== item.back.trim().toLowerCase())
          .map(c => c.back)
      ));
      shuffleArray(otherAnswers);
      const choices = [item.back, ...otherAnswers.slice(0, 3)];
      shuffleArray(choices); // Randomize so option 1 is not always the correct answer!

      mcqContainer.innerHTML = choices.map((choice, i) => {
        const isTarget = choice.trim().toLowerCase() === item.back.trim().toLowerCase();
        return '<button class="mcq-btn" data-target="' + isTarget + '" onclick="checkMcqAnswer(' + isTarget + ', this)">' +
          '<span class="key-badge">' + (i + 1) + '</span>' +
          '<span>' + escapeHtml(choice) + '</span>' +
        '</button>';
      }).join("");
    } else {
      badge.innerText = "OPEN-ENDED TYPED";
      badge.classList.remove("highlight");
      mcqSection.style.display = "none";
      typeContainer.style.display = "flex";

      const input = document.getElementById("typed-answer-input");
      input.value = "";
      input.placeholder = "Type answer here...";
      setTimeout(() => input.focus(), 40);
    }

    updateMasteryStats();
  }

  // ── DRILL MODE ENGINE (Intensive Definition Production) ──
  function initDrillRound() {
    document.getElementById("stage-transition-box").style.display = "none";
    document.getElementById("learn-prompt").style.display = "block";

    const undrilled = sharedCards.filter(c => !c.drillPassed);
    if (undrilled.length === 0) {
      showCompletionScreen();
      return;
    }

    sharedCards.forEach(c => { delete c._retestedInRound; });

    shuffleArray(undrilled);
    const roundSize = computeSmartRoundSize(sharedCards.length, undrilled.length, true);
    const batch = undrilled.slice(0, roundSize);
    shuffleArray(batch); // Randomize presentation sequence within drill round

    drillState.roundQueue = batch;
    drillState.currentQueueIndex = 0;
    drillState.waitingForFeedback = false;
    drillState.isTransitioning = false;
    drillState.isInitialized = true;
    drillState.writtenCountSinceMcqBreak = 0;

    updateMasteryStats();
    renderDrillQuestion();
  }

  function renderDrillQuestion() {
    if (!drillState.isInitialized || drillState.roundQueue.length === 0) {
      initDrillRound();
      return;
    }

    if (drillState.currentQueueIndex >= drillState.roundQueue.length) {
      triggerRoundBreak();
      return;
    }

    drillState.waitingForFeedback = false;
    drillState.isTransitioning = false;
    document.getElementById("learn-feedback").style.display = "none";
    const overrideBtn = document.getElementById("feedback-override-btn");
    if (overrideBtn) overrideBtn.style.display = "none";

    const item = drillState.roundQueue[drillState.currentQueueIndex];
    document.getElementById("learn-prompt").innerHTML = parseCloze(item.front, false);

    const hintEl = document.getElementById("learn-hint");
    if (item.hint) {
      hintEl.innerText = "Hint: " + item.hint;
      hintEl.style.display = "block";
    } else {
      hintEl.style.display = "none";
    }

    const mcqSection = document.getElementById("mcq-section");
    const mcqContainer = document.getElementById("mcq-options-container");
    const typeContainer = document.getElementById("type-box-container");
    const badge = document.getElementById("question-type-badge");

    if (item.isMicroBreak) {
      badge.innerText = "MICRO MCQ BREAK";
      badge.classList.add("highlight");
      mcqSection.style.display = "block";
      mcqContainer.style.display = "grid";
      typeContainer.style.display = "none";

      const otherAnswers = Array.from(new Set(
        sharedCards
          .filter(c => c.id !== item.id && c.back.trim().toLowerCase() !== item.back.trim().toLowerCase())
          .map(c => c.back)
      ));
      shuffleArray(otherAnswers);
      const choices = [item.back, ...otherAnswers.slice(0, 3)];
      shuffleArray(choices);

      mcqContainer.innerHTML = choices.map((choice, i) => {
        const isTarget = choice.trim().toLowerCase() === item.back.trim().toLowerCase();
        return '<button class="mcq-btn" data-target="' + isTarget + '" onclick="checkMcqAnswer(' + isTarget + ', this)">' +
          '<span class="key-badge">' + (i + 1) + '</span>' +
          '<span>' + escapeHtml(choice) + '</span>' +
        '</button>';
      }).join("");
    } else {
      badge.innerText = "WRITTEN DEFINITION DRILL";
      badge.classList.add("highlight");
      mcqSection.style.display = "none";
      typeContainer.style.display = "flex";

      const input = document.getElementById("typed-answer-input");
      input.value = "";
      input.placeholder = "Write complete definition from memory...";
      setTimeout(() => input.focus(), 40);
    }

    updateMasteryStats();
  }

  // ── Stats Display (Knowt 3-Tier Multi-Segment Progress) ──
  function updateMasteryStats() {
    const mastered = sharedCards.filter(c => c.level === 2).length;
    const familiar = sharedCards.filter(c => c.level === 1).length;
    const remaining = sharedCards.filter(c => c.level === 0).length;
    const drilled = sharedCards.filter(c => c.drillPassed).length;
    const total = sharedCards.length;

    const modeLabel = document.getElementById("stat-mode-label");
    const statVal = document.getElementById("stat-mastered");
    const familiarVal = document.getElementById("stat-familiar");
    const remainingVal = document.getElementById("stat-remaining");
    const roundVal = document.getElementById("stat-round");
    const roundLabel = document.getElementById("progress-round-label");
    const roundIndicator = document.getElementById("round-indicator");
    const fillMastered = document.getElementById("progress-fill-mastered");
    const fillFamiliar = document.getElementById("progress-fill-familiar");
    const percentEl = document.getElementById("progress-percent");

    if (familiarVal) familiarVal.innerText = familiar;
    if (remainingVal) remainingVal.innerText = remaining;

    if (currentMode === "drill") {
      if (modeLabel) modeLabel.innerText = "DRILLED";
      if (statVal) statVal.innerText = drilled;
      if (roundVal) roundVal.innerText = drillState.roundNumber;

      const progressDrilled = total > 0 ? Math.round((drilled / total) * 100) : 0;
      if (fillMastered) fillMastered.style.width = progressDrilled + "%";
      if (fillFamiliar) fillFamiliar.style.width = "0%";
      if (percentEl) percentEl.innerText = progressDrilled + "%";

      if (roundLabel && drillState.roundQueue.length > 0) {
        roundLabel.innerText = "DRILL ROUND " + drillState.roundNumber + " • ITEM " + Math.min(drillState.currentQueueIndex + 1, drillState.roundQueue.length) + " OF " + drillState.roundQueue.length;
      }
      if (roundIndicator) {
        roundIndicator.innerText = "DRILL R" + drillState.roundNumber;
        roundIndicator.classList.add("highlight");
      }
    } else {
      if (modeLabel) modeLabel.innerText = "ACQUIRED";
      if (statVal) statVal.innerText = mastered;
      if (roundVal) roundVal.innerText = learnState.roundNumber;

      const pctMastered = total > 0 ? ((mastered / total) * 100) : 0;
      const pctFamiliar = total > 0 ? ((familiar / total) * 100) : 0;
      if (fillMastered) fillMastered.style.width = pctMastered + "%";
      if (fillFamiliar) fillFamiliar.style.width = pctFamiliar + "%";
      if (percentEl) percentEl.innerText = Math.round(pctMastered) + "% ACQUIRED (" + Math.round(pctMastered + pctFamiliar) + "% ACTIVE)";

      if (roundLabel && learnState.roundQueue.length > 0) {
        roundLabel.innerText = "ROUND " + learnState.roundNumber + " • ITEM " + Math.min(learnState.currentQueueIndex + 1, learnState.roundQueue.length) + " OF " + learnState.roundQueue.length;
      }
      if (roundIndicator) {
        roundIndicator.innerText = "ROUND " + learnState.roundNumber;
        roundIndicator.classList.remove("highlight");
      }
    }
  }

  // ── Permanent Anti-Loop & Anti-Repeat Queue Controller ──
  function queueMissedCard(state, item) {
    if (!item || !state || !state.roundQueue) return;

    // Rule 1: A card can NEVER be re-tested more than once in the same round
    if (item._retestedInRound) return;

    // Rule 2: Never allow duplicate copies of the same card in the queue ahead
    const remaining = state.roundQueue.slice(state.currentQueueIndex + 1);
    if (remaining.some(c => c.id === item.id)) return;

    // Rule 3: Never re-queue immediately if this is the last card in the round
    // (Prevents back-to-back repetition of the same card 0 seconds after viewing feedback)
    if (state.currentQueueIndex >= state.roundQueue.length - 1) {
      return;
    }

    item._retestedInRound = true;
    state.roundQueue.push(item);
  }

  // ── Answering & Evaluation ──
  function checkMcqAnswer(isCorrect, btnEl) {
    const isDrill = currentMode === "drill";
    const state = isDrill ? drillState : learnState;
    if (state.waitingForFeedback || state.isTransitioning) return;

    const item = state.roundQueue[state.currentQueueIndex];
    if (!item) return;

    const correctAnswer = item.back;
    item.attempts = (item.attempts || 0) + 1;

    if (isCorrect) {
      state.isTransitioning = true;
      btnEl.classList.add("correct");
      playTone(587.33, 0.15);

      if (!item.isMicroBreak) {
        item.level = 1;
        syncCard(item.id, { level: 1, attempts: item.attempts });
      }

      persistProgress();
      updateMasteryStats();

      setTimeout(() => {
        state.isTransitioning = false;
        state.currentQueueIndex++;
        if (isDrill) renderDrillQuestion();
        else renderLearnQuestion();
      }, 320);
    } else {
      btnEl.classList.add("incorrect");
      playTone(220, 0.25);
      item.lapsed = true;
      syncCard(item.id, { lapsed: true, attempts: item.attempts });
      state.waitingForFeedback = true;

      const buttons = document.querySelectorAll(".mcq-btn");
      buttons.forEach(b => {
        if (b.getAttribute("data-target") === "true") {
          b.classList.add("correct");
        } else {
          b.classList.add("dimmed");
        }
      });

      const fb = document.getElementById("learn-feedback");
      fb.className = "feedback-box incorrect";
      const badgeEl = document.getElementById("feedback-badge");
      if (badgeEl) badgeEl.innerText = "STUDY THIS ONE";
      document.getElementById("feedback-message").innerText = "Target: " + item.back;
      document.getElementById("feedback-diff").innerText = item.mnemonic ? ("Mnemonic: " + item.mnemonic) : "";
      const overrideBtn = document.getElementById("feedback-override-btn");
      if (overrideBtn) overrideBtn.style.display = "none";

      const reinforceBox = document.getElementById("reinforce-copy-box");
      const reinforceInput = document.getElementById("reinforce-copy-input");
      if (reinforceBox && reinforceInput) {
        reinforceBox.style.display = "block";
        reinforceInput.value = "";
        reinforceInput.style.borderColor = "";
        setTimeout(() => reinforceInput.focus(), 50);
      }

      fb.style.display = "block";

      queueMissedCard(state, item);
      persistProgress();
      updateMasteryStats();
    }
  }

  function handleDontKnow() {
    const isDrill = currentMode === "drill";
    const state = isDrill ? drillState : learnState;
    if (state.waitingForFeedback || state.isTransitioning) return;

    const item = state.roundQueue[state.currentQueueIndex];
    if (!item) return;

    item.attempts = (item.attempts || 0) + 1;
    item.lapsed = true;

    if (isDrill) {
      item.drillPassed = false;
      item.level = 1; // Slight mastery reduction in drill mode
      syncCard(item.id, { drillPassed: false, level: 1, attempts: item.attempts, lapsed: true });
    } else {
      item.level = 0;
      syncCard(item.id, { level: 0, attempts: item.attempts, lapsed: true });
    }

    state.waitingForFeedback = true;

    // Knowt Learn visual cue: highlight target answer in MCQ options and dim others
    const buttons = document.querySelectorAll(".mcq-btn");
    buttons.forEach(b => {
      if (b.getAttribute("data-target") === "true") {
        b.classList.add("correct");
      } else {
        b.classList.add("dimmed");
      }
    });

    playTone(220, 0.25);
    const fb = document.getElementById("learn-feedback");
    fb.className = "feedback-box incorrect";
    const badgeEl = document.getElementById("feedback-badge");
    if (badgeEl) badgeEl.innerText = "DON'T KNOW — STUDY THIS ONE";
    document.getElementById("feedback-message").innerText = "Target: " + item.back;
    document.getElementById("feedback-diff").innerText = item.mnemonic ? ("Mnemonic: " + item.mnemonic) : "Take note of this term — it will be reinforced later in this round.";
    const overrideBtn = document.getElementById("feedback-override-btn");
    if (overrideBtn) overrideBtn.style.display = "none";

    const reinforceBox = document.getElementById("reinforce-copy-box");
    const reinforceInput = document.getElementById("reinforce-copy-input");
    if (reinforceBox && reinforceInput) {
      reinforceBox.style.display = "block";
      reinforceInput.value = "";
      reinforceInput.style.borderColor = "";
      setTimeout(() => reinforceInput.focus(), 50);
    }

    fb.style.display = "block";

    queueMissedCard(state, item);
    persistProgress();
    updateMasteryStats();
  }

  function checkReinforceInput(val) {
    const isDrill = currentMode === "drill";
    const state = isDrill ? drillState : learnState;
    const item = state.roundQueue[state.currentQueueIndex];
    if (!item) return;

    if (checkAnswerMatch(val, item.back)) {
      playTone(587.33, 0.12);
      const input = document.getElementById("reinforce-copy-input");
      if (input) input.style.borderColor = "var(--status-correct)";
      setTimeout(() => {
        advanceQuestion();
      }, 250);
    }
  }

  function normalizeForComparison(str) {
    if (!str) return "";
    return str
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "") // strip accents
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\\-_~()?'"¡¿+\\x60]/g, " ") // punctuation to space
      .replace(/\\s+/g, " ") // collapse whitespace safely
      .trim();
  }

  function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const d = [];
    for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      }
    }
    return d[a.length][b.length];
  }

  function checkAnswerMatch(userRaw, targetRaw) {
    const userClean = normalizeForComparison(userRaw);
    const targetClean = normalizeForComparison(targetRaw);
    if (!userClean) return false;
    if (userClean === targetClean) return true;

    // Split target by semicolon, slash, or comma for alternative answers / synonyms
    const alternatives = targetRaw
      .split(/[;/,]/)
      .map(s => normalizeForComparison(s))
      .filter(s => s.length > 0);

    if (alternatives.includes(userClean)) return true;

    // Check typo tolerance on individual alternatives
    for (const alt of alternatives) {
      if (alt.length >= 3 && levenshteinDistance(userClean, alt) <= (alt.length > 6 ? 2 : 1)) {
        return true;
      }
    }

    // Check typo tolerance on full target
    if (targetClean.length >= 4 && levenshteinDistance(userClean, targetClean) <= (targetClean.length > 8 ? 2 : 1)) {
      return true;
    }

    // Check word subset (user typed all key words of an alternative or target)
    const userWords = userClean.split(" ").filter(w => w.length > 0);
    for (const alt of alternatives) {
      const altWords = alt.split(" ").filter(w => w.length > 0);
      if (altWords.length > 0) {
        const matched = altWords.filter(w => userWords.includes(w));
        if (matched.length === altWords.length) return true;
      }
    }

    return false;
  }

  function submitTypedAnswer() {
    const isDrill = currentMode === "drill";
    const state = isDrill ? drillState : learnState;
    if (state.waitingForFeedback || state.isTransitioning) return;

    const item = state.roundQueue[state.currentQueueIndex];
    if (!item) return;

    const input = document.getElementById("typed-answer-input");
    const isMatch = checkAnswerMatch(input.value, item.back);

    item.attempts = (item.attempts || 0) + 1;

    if (isMatch) {
      state.isTransitioning = true;
      playTone(587.33, 0.15);

      if (isDrill) {
        item.drillPassed = true;
        item.level = 2;
        syncCard(item.id, { drillPassed: true, level: 2, attempts: item.attempts });
        drillState.writtenCountSinceMcqBreak++;

        // Micro MCQ Break every 4 written items in Drill mode:
        if (false && drillState.writtenCountSinceMcqBreak >= 4) {
          const breakCards = sharedCards.filter(c => c.id !== item.id);
          if (breakCards.length > 0) {
            const randomCard = breakCards[Math.floor(Math.random() * breakCards.length)];
            drillState.roundQueue.splice(drillState.currentQueueIndex + 1, 0, {
              ...randomCard,
              isMicroBreak: true,
            });
          }
          drillState.writtenCountSinceMcqBreak = 0;
        }
      } else {
        item.level = 2; // Mastered in Learn mode!
        syncCard(item.id, { level: 2, attempts: item.attempts });
      }

      persistProgress();
      updateMasteryStats();

      const fb = document.getElementById("learn-feedback");
      fb.className = "feedback-box correct";
      document.getElementById("feedback-message").innerText = "✓ Correct!";
      document.getElementById("feedback-diff").innerText = item.back;
      const overrideBtn = document.getElementById("feedback-override-btn");
      if (overrideBtn) overrideBtn.style.display = "none";
      fb.style.display = "block";

      setTimeout(() => {
        state.isTransitioning = false;
        state.currentQueueIndex++;
        if (isDrill) renderDrillQuestion();
        else renderLearnQuestion();
      }, 350);
      return;
    }

    // Incorrect answer:
    state.waitingForFeedback = true;
    item.lapsed = true;

    if (isDrill) {
      item.drillPassed = false;
      item.level = 1; // Slight reduction: from 2 to 1 (not wiped out to 0)
      syncCard(item.id, { drillPassed: false, level: 1, attempts: item.attempts, lapsed: true });
    } else {
      item.level = 0;
      syncCard(item.id, { level: 0, attempts: item.attempts, lapsed: true });
    }

    playTone(330, 0.2);
    const fb = document.getElementById("learn-feedback");
    fb.className = "feedback-box incorrect";
    const badgeEl = document.getElementById("feedback-badge");
    if (badgeEl) badgeEl.innerText = "STUDY THIS ONE";
    document.getElementById("feedback-message").innerText = "Target: " + item.back;
    document.getElementById("feedback-diff").innerText = 'You typed: "' + input.value + '"' + (item.mnemonic ? (" • Mnemonic: " + item.mnemonic) : "");
    const overrideBtn = document.getElementById("feedback-override-btn");
    if (overrideBtn) overrideBtn.style.display = "inline-block";

    const reinforceBox = document.getElementById("reinforce-copy-box");
    const reinforceInput = document.getElementById("reinforce-copy-input");
    if (reinforceBox && reinforceInput) {
      reinforceBox.style.display = "block";
      reinforceInput.value = "";
      reinforceInput.style.borderColor = "";
      setTimeout(() => reinforceInput.focus(), 50);
    }

    fb.style.display = "block";

    queueMissedCard(state, item);
    persistProgress();
    updateMasteryStats();
  }

  function overrideAsCorrect() {
    const isDrill = currentMode === "drill";
    const state = isDrill ? drillState : learnState;
    if (!state.waitingForFeedback) return;

    const item = state.roundQueue[state.currentQueueIndex];
    if (!item) return;

    const lastPushedIdx = state.roundQueue.lastIndexOf(item);
    if (lastPushedIdx > state.currentQueueIndex) {
      state.roundQueue.splice(lastPushedIdx, 1);
    }

    item.level = 2;
    item.lapsed = false;
    if (isDrill) {
      item.drillPassed = true;
    }
    syncCard(item.id, { level: 2, drillPassed: item.drillPassed, lapsed: false });

    playTone(880, 0.2);

    const fb = document.getElementById("learn-feedback");
    fb.className = "feedback-box correct";
    document.getElementById("feedback-message").innerText = "✓ Overridden — Marked as Correct";
    const overrideBtn = document.getElementById("feedback-override-btn");
    if (overrideBtn) overrideBtn.style.display = "none";

    persistProgress();
    updateMasteryStats();
  }

  function advanceQuestion() {
    const isDrill = currentMode === "drill";
    const state = isDrill ? drillState : learnState;
    state.isTransitioning = false;
    state.waitingForFeedback = false;
    const reinforceBox = document.getElementById("reinforce-copy-box");
    if (reinforceBox) reinforceBox.style.display = "none";
    state.currentQueueIndex++;
    if (isDrill) renderDrillQuestion();
    else renderLearnQuestion();
  }

  let restTimerInterval = null;
  function triggerRoundBreak() {
    const isDrill = currentMode === "drill";
    const state = isDrill ? drillState : learnState;

    if (!state.isInitialized || state.roundQueue.length === 0) return;
    if (state.currentQueueIndex < state.roundQueue.length) return;

    const modal = document.getElementById("rest-modal");
    const countEl = document.getElementById("rest-countdown");
    const tagEl = document.getElementById("rest-modal-tag");
    const descEl = document.getElementById("rest-modal-desc");
    const roundNumEl = document.getElementById("rest-round-num");
    const headlineEl = document.getElementById("rest-headline");

    const mastered = sharedCards.filter(c => c.level === 2).length;
    const familiar = sharedCards.filter(c => c.level === 1).length;
    const remaining = sharedCards.filter(c => c.level === 0).length;
    const drilled = sharedCards.filter(c => c.drillPassed).length;

    const sumMastered = document.getElementById("summary-mastered");
    const sumFamiliar = document.getElementById("summary-familiar");
    const sumRemaining = document.getElementById("summary-remaining");

    if (isDrill) {
      if (tagEl) tagEl.innerText = "DRILL ROUND SUMMARY";
      if (roundNumEl) roundNumEl.innerText = "DRILL ROUND " + drillState.roundNumber;
      if (headlineEl) headlineEl.innerText = "Intensive Recall Batch Complete!";
      if (sumMastered) sumMastered.innerText = drilled;
      if (sumFamiliar) sumFamiliar.innerText = familiar;
      if (sumRemaining) sumRemaining.innerText = sharedCards.length - drilled;
      if (descEl) {
        descEl.innerHTML = 'Written drill round <strong style="color: var(--text-primary);">' + drillState.roundNumber + '</strong> finished. Bönstrup et al. (2019): Rest for 10 seconds while memory traces solidify.';
      }
    } else {
      if (tagEl) tagEl.innerText = "ROUND SUMMARY";
      if (roundNumEl) roundNumEl.innerText = "ROUND " + learnState.roundNumber;
      if (headlineEl) headlineEl.innerText = "Great Progress! Round " + learnState.roundNumber + " Complete.";
      if (sumMastered) sumMastered.innerText = mastered;
      if (sumFamiliar) sumFamiliar.innerText = familiar;
      if (sumRemaining) sumRemaining.innerText = remaining;
      if (descEl) {
        descEl.innerHTML = 'Round <strong style="color: var(--text-primary);">' + learnState.roundNumber + '</strong> complete. Resting momentarily allows neural replay to lock familiar cards into long-term recall.';
      }
    }

    modal.classList.add("active");

    let remainingTime = 10;
    countEl.innerText = remainingTime + "s";
    playTone(392, 0.25);

    clearInterval(restTimerInterval);
    restTimerInterval = setInterval(() => {
      remainingTime--;
      countEl.innerText = remainingTime + "s";
      if (remainingTime <= 0) {
        closeMicroRest();
      }
    }, 1000);
  }

  function closeMicroRest() {
    clearInterval(restTimerInterval);
    document.getElementById("rest-modal").classList.remove("active");

    if (currentMode === "drill") {
      drillState.roundNumber++;
      persistProgress();
      initDrillRound();
    } else {
      learnState.roundNumber++;
      persistProgress();
      initLearnRound();
    }
  }

  function showCompletionScreen() {
    document.getElementById("view-learn").style.display = "none";
    document.getElementById("view-flashcards").style.display = "none";
    document.getElementById("completion-screen").classList.add("active");
    updateMasteryStats();
    document.getElementById("progress-round-label").innerText = "INTENSIVE DRILL COMPLETE • 100% MASTERY";
    document.getElementById("progress-fill").style.width = "100%";
    document.getElementById("progress-percent").innerText = "100%";
    playTone(659.25, 0.35);

    saveSessionResults();
  }

  function saveSessionResults() {
    const payload = {
      topic: deckData.topic,
      title: deckData.title,
      completedAt: new Date().toISOString(),
      totalCards: sharedCards.length,
      masteredCount: sharedCards.filter(c => c.level === 2 && c.drillPassed).length,
      roundsCompleted: Math.max(learnState.roundNumber, drillState.roundNumber),
      isFinalVerified: true,
      lapsedCards: sharedCards.filter(c => c.lapsed).map(c => ({
        id: c.id, front: c.front, back: c.back, attempts: c.attempts
      })),
      results: sharedCards.map(c => ({
        id: c.id, front: c.front, back: c.back, status: "mastered", attempts: c.attempts
      }))
    };

    fetch("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  function notifyPiCliTest() {
    saveSessionResults();
    const status = document.getElementById("cli-test-status");
    status.style.display = "block";
    playTone(523.25, 0.25);
  }

  // ── Flashcard Review Engine (Deck Order by Default + Shuffle Feature) ──
  let isFlashcardShuffled = false;
  let flashcardDeck = [...allCards]; // Preserves original deck order by default
  let flashcardIndex = 0;
  let isFlipped = false;

  function toggleFlashcardShuffle() {
    isFlashcardShuffled = !isFlashcardShuffled;
    const btn = document.getElementById("flashcard-shuffle-btn");
    if (isFlashcardShuffled) {
      flashcardDeck = [...allCards];
      shuffleArray(flashcardDeck);
      if (btn) {
        btn.innerText = "⤮ Shuffle: On [S]";
        btn.style.borderColor = "var(--status-correct)";
        btn.style.color = "var(--status-correct)";
      }
    } else {
      flashcardDeck = [...allCards]; // Restore deck order
      if (btn) {
        btn.innerText = "⤮ Shuffle: Off [S]";
        btn.style.borderColor = "";
        btn.style.color = "";
      }
    }
    flashcardIndex = 0;
    renderFlashcard();
    playTone(isFlashcardShuffled ? 659.25 : 440, 0.12);
  }

  function renderFlashcard() {
    if (flashcardDeck.length === 0) return;
    const card = flashcardDeck[flashcardIndex];
    isFlipped = false;

    const inner = document.getElementById("card-inner");
    if (inner) {
      inner.style.transition = "none";
      inner.classList.remove("is-flipped");
      void inner.offsetWidth;
      inner.style.transition = "";
    }

    document.getElementById("flashcard-rating-container").classList.remove("active");
    const numLabel = "#" + (flashcardIndex + 1);
    document.getElementById("flashcard-num-front").innerText = numLabel;
    document.getElementById("flashcard-num-back").innerText = numLabel;

    const statusLabel = document.getElementById("flashcard-status-label");
    if (statusLabel) {
      statusLabel.innerText = "CARD " + (flashcardIndex + 1) + " OF " + flashcardDeck.length + (isFlashcardShuffled ? " • SHUFFLED" : " • DECK ORDER");
    }

    document.getElementById("flashcard-front-text").innerHTML = parseCloze(card.front, false);

    const backEl = document.getElementById("flashcard-back-text");
    if (backEl) backEl.innerHTML = "";
  }

  function toggleFlashcardFlip() {
    if (flashcardDeck.length === 0) return;
    const card = flashcardDeck[flashcardIndex];
    isFlipped = !isFlipped;
    const inner = document.getElementById("card-inner");
    const rating = document.getElementById("flashcard-rating-container");
    const backEl = document.getElementById("flashcard-back-text");

    if (isFlipped) {
      if (backEl && card) backEl.innerHTML = parseCloze(card.back, true);
      inner.classList.add("is-flipped");
      rating.classList.add("active");
      playTone(520, 0.1);
    } else {
      inner.classList.remove("is-flipped");
      rating.classList.remove("active");
      playTone(440, 0.08);
    }
  }

  function submitFlashcardReview(grade) {
    if (flashcardDeck.length === 0) return;
    const card = flashcardDeck[flashcardIndex];

    const backEl = document.getElementById("flashcard-back-text");
    if (backEl) backEl.innerHTML = "";
    const inner = document.getElementById("card-inner");
    if (inner) {
      inner.style.transition = "none";
      inner.classList.remove("is-flipped");
      void inner.offsetWidth;
      inner.style.transition = "";
    }

    fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: card.id, grade })
    }).catch(() => {});

    if (flashcardIndex < flashcardDeck.length - 1) {
      flashcardIndex++;
      renderFlashcard();
    } else {
      showCompletionScreen();
    }
  }

  let isLight = false;
  function toggleTheme() {
    isLight = !isLight;
    document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    document.getElementById("theme-toggle").innerText = isLight ? "☾ Dark" : "☼ Light";
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    document.getElementById("sound-toggle").innerText = soundEnabled ? "Vol: On" : "Vol: Off";
  }

  window.addEventListener("keydown", (e) => {
    // Spaces are part of multi-word vocabulary answers, never a global skip key.
    const target = e.target;
    const isEditable = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (isEditable && e.code === "Space") return;

    const modal = document.getElementById("rest-modal");
    if (modal && modal.classList.contains("active")) {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        closeMicroRest();
        return;
      }
    }

    if (currentMode === "learn" || currentMode === "drill") {
      const state = currentMode === "drill" ? drillState : learnState;
      if (state.waitingForFeedback) {
        if (e.code === "KeyO" || e.key === "o" || e.key === "O") {
          const overrideBtn = document.getElementById("feedback-override-btn");
          if (overrideBtn && overrideBtn.style.display !== "none") {
            e.preventDefault();
            overrideAsCorrect();
            return;
          }
        }
        if (e.code === "Space" || e.code === "Enter") {
          e.preventDefault();
          advanceQuestion();
        }
        return;
      }

      const item = state.roundQueue[state.currentQueueIndex];
      const isMcq = item && (item.isMicroBreak || (currentMode === "learn" && item.level === 0));

      if (isMcq) {
        if (e.code === "Escape") {
          e.preventDefault();
          handleDontKnow();
        } else if (["1", "2", "3", "4"].includes(e.key)) {
          const idx = parseInt(e.key) - 1;
          const btns = document.querySelectorAll(".mcq-btn");
          if (btns[idx]) btns[idx].click();
        }
      } else {
        if (e.code === "Enter") {
          submitTypedAnswer();
        } else if (e.code === "Escape") {
          e.preventDefault();
          handleDontKnow();
        }
      }
    } else if (currentMode === "flashcards") {
      if (e.code === "KeyS" || e.key === "s" || e.key === "S") {
        e.preventDefault();
        toggleFlashcardShuffle();
      } else if (e.code === "Space") {
        e.preventDefault();
        toggleFlashcardFlip();
      } else if (isFlipped && ["1", "2", "3", "4"].includes(e.key)) {
        submitFlashcardReview(parseInt(e.key));
      }
    }
  });

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  loadPersistedProgress();
  switchMode(currentMode);
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

// ── Extension Definition ───────────────────────────────────────────────────

export default function webMemorizeExtension(pi: ExtensionAPI) {
	// ── open_memorize_web tool ───────────────────────────────────────────

	pi.registerTool({
		name: "open_memorize_web",
		label: "open memorize web",
		description:
			"Open an interactive, research-backed local web app for memorization featuring Quizlet Learn mode and flashcards. Saves the learner-visible deck to content/exports/, runs a local HTTP server with live sync, active recall occlusion, and micro-rest intervals.",
		promptSnippet:
			"Offer open_memorize_web when the learner wants a dedicated memorization or flashcard session, or observed performance shows a specific item-retention bottleneck. It provides typed recall and optional micro-breaks. Do not launch a browser for a passing mention of a formula or definition; use separate diagnostic tools for difficult MCQs.",
		parameters: Type.Object({
			topic: Type.String({ description: "Topic slug or title (e.g. 'synaptic-transmission' or 'spanish-verbs')" }),
			title: Type.Optional(Type.String({ description: "Display title for the deck" })),
			mode: Type.Optional(
				Type.Union([
					Type.Literal("learn"),
					Type.Literal("flashcards"),
					Type.Literal("drill"),
					Type.Literal("cloze"),
					Type.Literal("spaced_review"),
					Type.Literal("palace_walk"),
				]),
			),
			cards: Type.Optional(
				Type.Array(
					Type.Object({
						id: Type.Optional(Type.String()),
						front: Type.String({ description: "Prompt / question / cue (supports Cloze {{c1::answer}})" }),
						back: Type.String({ description: "Target answer / formula / explanation" }),
						hint: Type.Optional(Type.String({ description: "Optional progressive cue" })),
						mnemonic: Type.Optional(Type.String({ description: "Optional vivid sensory peg or story" })),
						locus: Type.Optional(Type.String({ description: "Optional memory palace locus" })),
						difficulty: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
						tags: Type.Optional(Type.Array(Type.String())),
					}),
				),
			),
			syncFsrs: Type.Optional(Type.Boolean({ description: "Whether to persist cards to _learning/reviews/cards.json (default true)" })),
			autoOpenBrowser: Type.Optional(Type.Boolean({ description: "Whether to automatically open the default web browser (default true)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const topic = params.topic.trim();
			const title = params.title?.trim() || `${topic.toUpperCase()} — Active Memorization`;
			const mode = params.mode || "learn";
			const syncFsrs = params.syncFsrs !== false;
			const autoOpen = params.autoOpenBrowser !== false;

			let finalCards: WebCard[] = [];

			if (params.cards && params.cards.length > 0) {
				const existingData = loadCardsFile(cwd);
				for (const c of params.cards) {
					const cardId = c.id || crypto.randomUUID();
					const webCard: WebCard = {
						id: cardId,
						front: c.front.trim(),
						back: c.back.trim(),
						topic: topic,
						skill: topic,
						difficulty: c.difficulty ?? 5,
						hint: c.hint?.trim(),
						mnemonic: c.mnemonic?.trim(),
						locus: c.locus?.trim(),
						tags: c.tags || [topic],
					};
					finalCards.push(webCard);

					if (syncFsrs) {
						const match = existingData.cards.find(
							(ec) => ec.topic === topic && ec.front.toLowerCase() === webCard.front.toLowerCase(),
						);
						if (!match) {
							existingData.cards.push({
								...webCard,
								stability: 0,
								createdAt: new Date().toISOString(),
								reps: 0,
								lapses: 0,
							});
						}
					}
				}
				if (syncFsrs) {
					saveCardsFile(cwd, existingData);
				}
			} else {
				const storedData = loadCardsFile(cwd);
				const matched = storedData.cards.filter(
					(c) => c.topic.toLowerCase() === topic.toLowerCase() || topic === "all" || topic === "General",
				);
				if (matched.length > 0) {
					finalCards = matched.map((c) => ({
						id: c.id,
						front: c.front,
						back: c.back,
						topic: c.topic,
						skill: c.skill,
						difficulty: c.difficulty,
						tags: c.tags,
					}));
				} else if (storedData.cards.length > 0) {
					finalCards = storedData.cards.slice(0, 20).map((c) => ({
						id: c.id,
						front: c.front,
						back: c.back,
						topic: c.topic,
						skill: c.skill,
						difficulty: c.difficulty,
						tags: c.tags,
					}));
				}
			}

			if (finalCards.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No cards found for topic "${topic}". Please provide an array of cards with { front, back } to launch the web memorizer.`,
						},
					],
				};
			}

			serverState.currentDeck = {
				topic,
				title,
				mode,
				cards: finalCards,
			};

			const contentPath = saveDeckToObsidian(cwd, topic, title, mode, finalCards);
			const htmlContent = generateMemorizeHtml(serverState.currentDeck);
			const webDir = getWebDir(cwd);
			const htmlPath = path.join(webDir, "memorize.html");
			fs.writeFileSync(htmlPath, htmlContent, "utf-8");
			fs.writeFileSync(path.join(webDir, "index.html"), htmlContent, "utf-8");

			const port = await ensureServerRunning(cwd);
			const localUrl = `http://127.0.0.1:${port}/memorize.html`;

			if (autoOpen) {
				openBrowser(localUrl);
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `🚀 Launched Quizlet Learn & Memorizer for "${title}" with ${finalCards.length} cards.\n\nLocal Web URL: ${localUrl}\nRuntime File: ${htmlPath}\nObsidian Deck: ${contentPath}\n\nFeatures Active:\n- Minimalist Editorial Aesthetic (Monochrome, high-contrast, Light/Dark toggle)\n- Quizlet Learn Mode: Open-Ended Typed Recall in Rounds (vocabulary/memorization)\n- Learner-paced rounds with typed production (starts directly on Round 1, Item 1)\n- Bönstrup 10-second micro-rest consolidation intervals between rounds\n- Zero-leak flashcard flipping (Back text cleared until explicitly flipped)\n- Once complete, run the CLI verification test using \`run_review_test\` or \`/test\`!`,
					},
				],
				details: {
					url: localUrl,
					cardCount: finalCards.length,
					deck: serverState.currentDeck,
					contentPath,
				},
			};
		},
	});

	// ── run_review_test tool ─────────────────────────────────────────────

	pi.registerTool({
		name: "run_review_test",
		label: "run review test",
		description:
			"Inspect results from the most recent web practice session or due tasks, and return candidate items for terminal verification. Browser success is same-session acquisition only; administer short-answer questions in Pi to verify independent retrieval, then schedule delayed changed-context evidence.",
		promptSnippet:
			"POST-WEB TEST MANDATE: After the learner reviews cards in the browser, call run_review_test to inspect recent session results. Then administer short-answer verification tests in the Pi terminal using `quiz` (omitting `options`) to prove unprompted recall.",
		parameters: Type.Object({
			topic: Type.Optional(Type.String({ description: "Topic to test (defaults to most recently learned topic)" })),
			count: Type.Optional(Type.Number({ description: "Number of questions to test (default 3–5)" })),
			targetLapsesOnly: Type.Optional(Type.Boolean({ description: "If true, only test cards that struggled or lapsed (default true)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const count = params.count || 5;
			const lastSession = loadLastSession(cwd);
			const cardsFile = loadCardsFile(cwd);

			let testItems: Array<{ front: string; back: string; reason: string }> = [];

			if (lastSession && (!params.topic || lastSession.topic.toLowerCase() === params.topic.toLowerCase())) {
				if (lastSession.lapsedCards && lastSession.lapsedCards.length > 0) {
					for (const c of lastSession.lapsedCards) {
						testItems.push({
							front: c.front,
							back: c.back,
							reason: `Struggled in web session (${c.attempts} attempts)`,
						});
					}
				}
				if (testItems.length < count && lastSession.results) {
					for (const r of lastSession.results) {
						if (!testItems.some(t => t.front === r.front)) {
							testItems.push({
								front: r.front,
								back: r.back,
								reason: "Acquired in web session — verify unassisted CLI recall and schedule delayed transfer",
							});
							if (testItems.length >= count) break;
						}
					}
				}
			}

			if (testItems.length === 0 && cardsFile.cards.length > 0) {
				const filtered = params.topic
					? cardsFile.cards.filter(c => c.topic.toLowerCase() === params.topic!.toLowerCase())
					: cardsFile.cards;
				const sorted = [...filtered].sort((a, b) => (a.stability ?? 2.4) - (b.stability ?? 2.4));
				for (const c of sorted.slice(0, count)) {
					testItems.push({
						front: c.front,
						back: c.back,
						reason: `FSRS review card (Stability: ${c.stability ?? 2.4}d, Lapses: ${c.lapses ?? 0})`,
					});
				}
			}

			if (testItems.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No cards available for review test. Please run `open_memorize_web` first or provide cards.",
						},
					],
				};
			}

			const formattedList = testItems.map((item, i) => `${i + 1}. **Cue:** "${item.front}" → **Target Answer:** "${item.back}" (${item.reason})`).join("\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `📋 Ready to test ${testItems.length} items in Pi Terminal!\n\n${formattedList}\n\n**TUTOR ACTION REQUIRED:**\nCall the \`quiz\` tool for each item in **short-answer mode** (omit \`options\`, set \`correctAnswer: item.back\`) so the user must type the answer directly into the Pi CLI. Never print the answers in chat before testing!`,
					},
				],
				details: {
					topic: params.topic || lastSession?.topic || "General",
					items: testItems,
				},
			};
		},
	});

	// ── /memorize and /flashcards commands ───────────────────────────────

	pi.registerCommand("memorize", {
		description: "Open the interactive local web Quizlet Learn & flashcard tool in your browser",
		async handler(_args, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const port = await ensureServerRunning(cwd);
			const localUrl = `http://127.0.0.1:${port}/memorize.html`;
			openBrowser(localUrl);
			ctx.ui.notify?.(`Opening web memorizer at ${localUrl}...`, "info");
		},
	});

	pi.registerCommand("drill", {
		description: "Open interactive local web Drill tool (intensive definition writing) in your browser",
		async handler(_args, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const port = await ensureServerRunning(cwd);
			const localUrl = `http://127.0.0.1:${port}/memorize.html#drill`;
			openBrowser(localUrl);
			ctx.ui.notify?.(`Opening web drill at ${localUrl}...`, "info");
		},
	});

	pi.registerCommand("flashcards", {
		description: "Alias for /memorize",
		async handler(_args, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const port = await ensureServerRunning(cwd);
			const localUrl = `http://127.0.0.1:${port}/memorize.html`;
			openBrowser(localUrl);
			ctx.ui.notify?.(`Opening web flashcards at ${localUrl}...`, "info");
		},
	});

	// ── /test command ────────────────────────────────────────────────────

	pi.registerCommand("test", {
		description: "Run an unassisted terminal verification test on recently learned cards or due reviews",
		async handler(_args, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const lastSession = loadLastSession(cwd);
			const topic = args.trim() || lastSession?.topic || "General";
			ctx.ui.notify?.(`Running review test for "${topic}"... Asking tutor to administer short-answer questions.`, "info");
		},
	});
}
