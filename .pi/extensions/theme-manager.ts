/**
 * theme-manager — Interactive theme and package controls within the Pi harness.
 * 
 * Note: These controls are registered strictly as human user commands via pi.registerCommand,
 * and do NOT expose tools or prompts to the AI model.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	loadThemes,
	getActiveTheme,
	setActiveTheme,
	addTheme,
	removeTheme,
} from "../core/themes.ts";
import {
	getInstalledPackages,
	installPackage,
	updatePackages,
	removePackage,
} from "../core/packages.ts";

export default function themeManager(pi: ExtensionAPI) {
	// 1. /theme — View or switch active theme interactively
	pi.registerCommand("theme", {
		description: "View or switch learning theme (Usage: /theme [name])",
		handler: async (args: string, ctx: any) => {
			const cwd = ctx.cwd || process.cwd();
			const target = args.trim().toLowerCase();

			if (target) {
				const available = loadThemes(cwd);
				const found = available.find(
					(t) => t.name.toLowerCase() === target || t.displayName?.toLowerCase() === target
				);
				const themeToSet = found ? found.name : target;
				setActiveTheme(themeToSet, cwd);
				ctx.ui?.notify?.(`[Theme] Active theme set to '${themeToSet}'.`, "success");
				return;
			}

			// If no argument, show interactive selector if available, or list
			const themes = loadThemes(cwd);
			const current = getActiveTheme(cwd);

			if (ctx.ui?.select) {
				const options = themes.map((t) => {
					const mark = t.name.toLowerCase() === current.toLowerCase() ? " (Active)" : "";
					return `${t.name} — ${t.displayName || t.name}${mark}`;
				});

				try {
					const choice = await ctx.ui.select("Select learning environment theme:", options);
					if (choice) {
						const selectedName = choice.split(" — ")[0].trim();
						setActiveTheme(selectedName, cwd);
						ctx.ui?.notify?.(`[Theme] Switched to '${selectedName}'.`, "success");
					}
					return;
				} catch {
					// Fall through to notification list if interactive select fails or is cancelled
				}
			}

			// Fallback: Notify list
			const lines = [
				`[Themes] Active: ${current}`,
				"Available themes:",
				...themes.map(
					(t) => `  • ${t.name} (${t.displayName || t.name})${t.name.toLowerCase() === current.toLowerCase() ? " [ACTIVE]" : ""}`
				),
				"To switch: /theme <name>",
			];
			ctx.ui?.notify?.(lines.join("\n"), "info");
		},
	});

	// 2. /themes — Display all available local themes with descriptions
	pi.registerCommand("themes", {
		description: "List all local themes with descriptions",
		handler: async (_args: string, ctx: any) => {
			const cwd = ctx.cwd || process.cwd();
			const themes = loadThemes(cwd);
			const current = getActiveTheme(cwd);

			const lines = [
				`🎨 [Learning Themes] (Current: ${current})`,
				"",
				...themes.map((t) => {
					const mark = t.name.toLowerCase() === current.toLowerCase() ? " ★ [ACTIVE]" : "";
					const desc = t.description ? `\n    ${t.description}` : "";
					return `• ${t.displayName || t.name} (${t.name})${mark}${desc}`;
				}),
				"",
				"Switch theme: /theme <name>",
				"Add theme: /add-theme <id> [accentHex]",
			];
			ctx.ui?.notify?.(lines.join("\n"), "info");
		},
	});

	// 3. /add-theme — Create custom local theme
	pi.registerCommand("add-theme", {
		description: "Create a custom local theme (Usage: /add-theme <id> [accentHex])",
		handler: async (args: string, ctx: any) => {
			const cwd = ctx.cwd || process.cwd();
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (!parts.length) {
				ctx.ui?.notify?.("Usage: /add-theme <id> [accentHex]", "warning");
				return;
			}

			const themeId = parts[0].toLowerCase();
			const accentColor = parts[1] || "#818cf8";

			const created = addTheme(
				{
					name: themeId,
					displayName: themeId.charAt(0).toUpperCase() + themeId.slice(1),
					description: `Custom ${themeId} theme with accent ${accentColor}`,
					type: "dark",
					tokens: {
						"--canvas": "#0c0d12",
						"--canvas-tint": "#14161f",
						"--grouped": "#14161f",
						"--sheet": "#1b1d28",
						"--border": "rgba(255,255,255,0.12)",
						"--border-strong": "rgba(255,255,255,0.28)",
						"--text": "#ffffff",
						"--text-secondary": "#c2c2c2",
						"--muted": "#999999",
						"--indigo": accentColor,
						"--indigo-hover": accentColor,
						"--indigo-soft": "#252140",
						"--sage": "#34d399",
						"--sage-soft": "#16382d",
						"--danger": "#ff928a",
					},
				},
				cwd
			);

			ctx.ui?.notify?.(`[Theme] Created custom theme '${created.name}'. Use '/theme ${created.name}' to activate.`, "success");
		},
	});

	// 4. /packages — View installed packages in .learn-runtime
	pi.registerCommand("packages", {
		description: "List packages and extensions installed in .learn-runtime",
		handler: async (_args: string, ctx: any) => {
			const cwd = ctx.cwd || process.cwd();
			const pkgs = getInstalledPackages(cwd);

			const lines = [
				`📦 [Installed Packages in .learn-runtime] (${pkgs.length} total)`,
				"",
				...pkgs.map((p) => {
					const tag = p.isEssential ? " [Core Provider]" : "";
					const v = p.version ? ` v${p.version}` : "";
					return `• ${p.name}${v}${tag}\n    ${p.description || "Extension package"}`;
				}),
				"",
				"Update all: /update-packages",
				"Install new: /install-package <name>",
			];
			ctx.ui?.notify?.(lines.join("\n"), "info");
		},
	});

	// 5. /update-packages — Update packages in .learn-runtime
	pi.registerCommand("update-packages", {
		description: "Update packages in .learn-runtime (Usage: /update-packages [package])",
		handler: async (args: string, ctx: any) => {
			const cwd = ctx.cwd || process.cwd();
			const pkg = args.trim() || undefined;

			ctx.ui?.notify?.(pkg ? `Updating ${pkg}...` : "Updating all packages in .learn-runtime...", "info");
			const result = updatePackages(pkg, cwd);

			if (result.success) {
				ctx.ui?.notify?.(pkg ? `Updated ${pkg} successfully.` : "All packages updated successfully.", "success");
			} else {
				ctx.ui?.notify?.(`Update failed: ${result.output}`, "error");
			}
		},
	});

	// 6. /install-package — Install extension into .learn-runtime
	pi.registerCommand("install-package", {
		description: "Install package into .learn-runtime (Usage: /install-package <name>)",
		handler: async (args: string, ctx: any) => {
			const cwd = ctx.cwd || process.cwd();
			const pkg = args.trim();
			if (!pkg) {
				ctx.ui?.notify?.("Usage: /install-package <name>", "warning");
				return;
			}

			ctx.ui?.notify?.(`Installing ${pkg} into isolated runtime...`, "info");
			const result = installPackage(pkg, cwd);

			if (result.success) {
				ctx.ui?.notify?.(`Installed ${pkg} successfully.`, "success");
			} else {
				ctx.ui?.notify?.(`Installation failed: ${result.output}`, "error");
			}
		},
	});

	// 7. /remove-package — Remove extension from .learn-runtime
	pi.registerCommand("remove-package", {
		description: "Remove extension from .learn-runtime (Usage: /remove-package <name>)",
		handler: async (args: string, ctx: any) => {
			const cwd = ctx.cwd || process.cwd();
			const pkg = args.trim();
			if (!pkg) {
				ctx.ui?.notify?.("Usage: /remove-package <name>", "warning");
				return;
			}

			const result = removePackage(pkg, cwd);
			if (result.success) {
				ctx.ui?.notify?.(`Removed ${pkg} from isolated runtime.`, "success");
			} else {
				ctx.ui?.notify?.(`Removal failed: ${result.output}`, "error");
			}
		},
	});
}
