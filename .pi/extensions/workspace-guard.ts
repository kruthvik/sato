/**
 * workspace-guard — Strict Workspace Boundary & File Containment Guard.
 *
 * Prevents the LLM from accessing, reading, listing, searching, or modifying
 * files outside the `learn` directory unless explicitly approved by the human user.
 *
 * ANTI-FAKE-CONSENT GUARANTEE:
 * Models can hallucinate user approval or pass self-declared consent flags.
 * This guard enforces physical human confirmation through `ctx.ui.confirm()`:
 * - Prompts render directly to the terminal TUI, pausing tool execution.
 * - The LLM's text output cannot respond to or bypass this UI prompt.
 * - In non-interactive contexts (no UI), external access is strictly blocked.
 * - The LLM is barred from modifying `_learning/security/` to prevent privilege escalation.
 *
 * Only active in this workspace; does not alter global Pi or runs in other folders.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

interface SecurityConfig {
	allowedPaths: string[];
}

function normalizePath(p: string): string {
	return path.resolve(p).replace(/\\/g, "/").toLowerCase();
}

function isSubpath(target: string, parent: string): boolean {
	const normTarget = normalizePath(target);
	const normParent = normalizePath(parent);
	return normTarget === normParent || normTarget.startsWith(normParent.endsWith("/") ? normParent : normParent + "/");
}

function getSecurityDir(cwd: string): string {
	return path.join(cwd, "_learning", "security");
}

function getConfigFile(cwd: string): string {
	return path.join(getSecurityDir(cwd), "allowed-paths.json");
}

function loadAllowedPaths(cwd: string): string[] {
	const cfg = getConfigFile(cwd);
	if (!fs.existsSync(cfg)) return [];
	try {
		const parsed: SecurityConfig = JSON.parse(fs.readFileSync(cfg, "utf-8"));
		return Array.isArray(parsed.allowedPaths) ? parsed.allowedPaths : [];
	} catch {
		return [];
	}
}

function saveAllowedPaths(cwd: string, paths: string[]): void {
	const secDir = getSecurityDir(cwd);
	if (!fs.existsSync(secDir)) {
		fs.mkdirSync(secDir, { recursive: true });
	}
	const cfg = getConfigFile(cwd);
	const data: SecurityConfig = { allowedPaths: Array.from(new Set(paths.map(p => path.resolve(p)))) };
	fs.writeFileSync(cfg, JSON.stringify(data, null, 2), "utf-8");
}

function resolveRealPathSafely(p: string): string {
	try {
		if (fs.existsSync(p)) {
			return fs.realpathSync.native(p);
		}
		// If the file doesn't exist yet, check its closest existing ancestor
		let cur = path.dirname(p);
		while (cur && cur !== path.dirname(cur)) {
			if (fs.existsSync(cur)) {
				const realCur = fs.realpathSync.native(cur);
				return path.join(realCur, path.relative(cur, p));
			}
			cur = path.dirname(cur);
		}
	} catch {
		// Fall back to resolved path
	}
	return path.resolve(p);
}

function isProtectedCorePath(target: string, cwd: string): boolean {
	const rel = path.relative(cwd, target).replace(/\\/g, "/").toLowerCase();
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		return false;
	}

	// Internal runtime, settings, and session mirrors
	if (rel === ".learn-runtime" || rel.startsWith(".learn-runtime/")) return true;
	if (rel === "_learning/security" || rel.startsWith("_learning/security/")) return true;
	if (rel === "_learning/current-session.json") return true;

	// Engine code and implementation
	if (rel === ".pi/core" || rel.startsWith(".pi/core/")) return true;
	if (rel === ".pi/extensions" || rel.startsWith(".pi/extensions/")) return true;

	// Workspace infrastructure, build scripts, and tests
	if (rel === "scripts" || rel.startsWith("scripts/")) return true;
	if (
		rel === "package.json" ||
		rel === "bun.lock" ||
		rel === "bun.lockb" ||
		rel === "learn.ps1" ||
		rel === "learn.cmd" ||
		rel === "settings.cmd" ||
		rel === "tsconfig.json"
	) {
		return true;
	}

	return false;
}

const FILE_TOOLS = new Set(["read", "write", "edit", "ls", "grep", "find"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);

export default function workspaceGuard(pi: ExtensionAPI) {
	// In-memory cache of approvals granted during the current session
	const sessionApprovedPaths = new Set<string>();

	pi.on("session_start", async (_event, ctx) => {
		const cwd = (ctx as any).cwd || process.cwd();
		const allowed = loadAllowedPaths(cwd);
		if ((ctx as any).ui?.setStatus) {
			const text = allowed.length > 0
				? `🛡️ Workspace Guard: Active (${allowed.length} external path${allowed.length > 1 ? "s" : ""})`
				: "🛡️ Workspace Guard: Active (Strict)";
			(ctx as any).ui.setStatus("workspace-guard", text);
		}
	});

	pi.on("tool_call", async (event: any, ctx: any) => {
		const cwd = ctx.cwd || process.cwd();
		const toolName: string = event.toolName;
		const input: Record<string, any> = event.input || {};

		// ── 1. Intercept file-based tools ────────────────────────────────────
		if (FILE_TOOLS.has(toolName)) {
			const targetPathRaw = input.path;
			if (!targetPathRaw || typeof targetPathRaw !== "string") {
				return;
			}

			const targetPath = path.isAbsolute(targetPathRaw)
				? path.resolve(targetPathRaw)
				: path.resolve(cwd, targetPathRaw);
			const realPath = resolveRealPathSafely(targetPath);

			// A. Self-protection: LLM is strictly prohibited from writing or editing security files
			if ((toolName === "write" || toolName === "edit") && isSubpath(targetPath, getSecurityDir(cwd))) {
				return {
					block: true,
					reason: "ACCESS DENIED: The AI model is strictly prohibited from modifying security configurations or allowed paths. Only the user may manage allowed paths via /allow-path.",
				};
			}

			// B. Core protection: The learning tutor must never inspect or modify engine code, runtime settings, or scripts
			if (isProtectedCorePath(targetPath, cwd) || isProtectedCorePath(realPath, cwd)) {
				const relPath = path.relative(cwd, targetPath).replace(/\\/g, "/");
				return {
					block: true,
					reason: `ACCESS RESTRICTED: You are a learning tutor and cannot read, list, or modify internal engine code, runtime settings, or infrastructure files ("${relPath}"). Use your registered tools to teach the learner, read material from sources/, and write notes/sheets to content/.`,
				};
			}

			// C. Check if inside workspace root
			const inWorkspaceByPath = isSubpath(targetPath, cwd);
			const inWorkspaceByReal = isSubpath(realPath, cwd);

			if (inWorkspaceByPath && inWorkspaceByReal) {
				// Safely within workspace
				return;
			}

			// Path is outside the workspace! Check explicit allowlist and session cache
			const persistedAllowed = loadAllowedPaths(cwd);
			const isAllowed =
				sessionApprovedPaths.has(normalizePath(targetPath)) ||
				sessionApprovedPaths.has(normalizePath(realPath)) ||
				persistedAllowed.some(allowed => isSubpath(targetPath, allowed) || isSubpath(realPath, allowed));

			if (isAllowed) {
				return;
			}

			// C. Path is outside and not yet allowed. Solicit explicit physical human consent.
			if (!ctx.hasUI || !ctx.ui?.confirm) {
				return {
					block: true,
					reason: `ACCESS DENIED: Path "${targetPath}" is outside the learning workspace ("${cwd}"). Access is strictly prohibited in non-interactive sessions.`,
				};
			}

			const userConfirmed = await ctx.ui.confirm(
				"External File Access Request",
				`The AI agent is attempting to ${toolName} a path outside the workspace:\n\n` +
				`Target: ${targetPath}\n` +
				`Workspace: ${cwd}\n\n` +
				`Do you explicitly authorize access to this specific path for this session?`
			);

			if (userConfirmed) {
				sessionApprovedPaths.add(normalizePath(targetPath));
				sessionApprovedPaths.add(normalizePath(realPath));
				ctx.ui.notify?.(`Granted access to: ${targetPath}`, "info");
				return;
			}

			return {
				block: true,
				reason: `ACCESS DENIED: The human user explicitly rejected access to "${targetPath}". You are strictly constrained to the learning workspace ("${cwd}"). Do not attempt to access this path again.`,
			};
		}

		// ── 2. Intercept shell commands (powershell, bash) ───────────────────
		if (SHELL_TOOLS.has(toolName)) {
			const command: string = input.command || "";
			if (!command.trim()) return;

			// Prohibit commands attempting to inspect learning core internals or settings
			const protectedCommandPatterns = [
				/\.learn-runtime/i,
				/_learning[/\\]security/i,
				/_learning[/\\]current-session\.json/i,
				/\.pi[/\\]core/i,
				/\.pi[/\\]extensions/i,
				/(^|[/\\]|\s)scripts[/\\]/i,
				/\blearn\.(ps1|cmd)\b/i,
				/\bsettings\.cmd\b/i,
			];
			for (const pattern of protectedCommandPatterns) {
				if (pattern.test(command)) {
					return {
						block: true,
						reason: `ACCESS RESTRICTED: Shell command is attempting to access internal learning runtime code or settings: "${command}". As a learning tutor, your role is to teach concepts, not inspect runtime internals.`,
					};
				}
			}

			// Check for signs of escaping the workspace or touching external files
			// Look for drive letters other than the current workspace, path traversal, or user profile references
			const normCwd = normalizePath(cwd);
			const hasTraversal = /\.\.[/\\]/.test(command);
			const hasAbsoluteDrive = /[a-zA-Z]:[/\\]/.test(command);
			const hasHomeRef = /%USERPROFILE%|\$HOME|~[/\\]|\$env:USERPROFILE/i.test(command);

			let suspicious = hasTraversal || hasHomeRef;

			if (hasAbsoluteDrive) {
				// Extract drive-qualified paths from command and see if any are outside cwd
				const driveMatches = command.match(/[a-zA-Z]:[\\/][^ \t\r\n"'>]+/g) || [];
				for (const m of driveMatches) {
					if (!isSubpath(m, cwd)) {
						suspicious = true;
						break;
					}
				}
			}

			if (suspicious) {
				if (!ctx.hasUI || !ctx.ui?.confirm) {
					return {
						block: true,
						reason: `ACCESS DENIED: Shell command contains external path or traversal references and cannot be approved in non-interactive mode: ${command}`,
					};
				}

				const confirmed = await ctx.ui.confirm(
					"External Shell Command Execution",
					`The AI agent is attempting to execute a shell command with external references:\n\n` +
					`Command: ${command}\n\n` +
					`Do you explicitly authorize running this command?`
				);

				if (!confirmed) {
					return {
						block: true,
						reason: `ACCESS DENIED: The human user rejected execution of command: "${command}". Stay within the learning workspace.`,
					};
				}
			}
		}
	});

	// ── User Commands ─────────────────────────────────────────────────────────

	pi.registerCommand("allowed-paths", {
		description: "List all paths outside the learning workspace authorized for access",
		handler: async (_args: string, ctx: ExtensionContext) => {
			const cwd = ctx.cwd || process.cwd();
			const list = loadAllowedPaths(cwd);
			const sessionList = Array.from(sessionApprovedPaths);

			if (list.length === 0 && sessionList.length === 0) {
				ctx.ui.notify("No external paths are currently authorized. Workspace containment is 100% strict.", "info");
				return;
			}

			const lines = ["Authorized External Paths:"];
			if (list.length > 0) {
				lines.push("Persistent:");
				list.forEach(p => lines.push(`  - ${p}`));
			}
			if (sessionList.length > 0) {
				lines.push("Session Only:");
				sessionList.forEach(p => lines.push(`  - ${p}`));
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("allow-path", {
		description: "Explicitly authorize an external file or directory (Usage: /allow-path <path>)",
		handler: async (args: string, ctx: ExtensionContext) => {
			const target = args.trim();
			if (!target) {
				ctx.ui.notify("Usage: /allow-path <path to file or directory>", "warning");
				return;
			}
			const cwd = ctx.cwd || process.cwd();
			const resolved = path.resolve(target);
			const current = loadAllowedPaths(cwd);
			if (!current.includes(resolved)) {
				current.push(resolved);
				saveAllowedPaths(cwd, current);
				ctx.ui.notify(`Authorized external path: ${resolved}`, "info");
			} else {
				ctx.ui.notify(`Path is already authorized: ${resolved}`, "info");
			}
		},
	});

	pi.registerCommand("disallow-path", {
		description: "Revoke authorization for an external path (Usage: /disallow-path <path>)",
		handler: async (args: string, ctx: ExtensionContext) => {
			const target = args.trim();
			if (!target) {
				ctx.ui.notify("Usage: /disallow-path <path to file or directory>", "warning");
				return;
			}
			const cwd = ctx.cwd || process.cwd();
			const resolved = path.resolve(target);
			const current = loadAllowedPaths(cwd);
			const filtered = current.filter(p => normalizePath(p) !== normalizePath(resolved));
			sessionApprovedPaths.delete(normalizePath(resolved));
			saveAllowedPaths(cwd, filtered);
			ctx.ui.notify(`Revoked authorization for: ${resolved}`, "info");
		},
	});
}
