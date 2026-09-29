import * as fs from "node:fs";
import * as path from "node:path";

export interface ThemeDefinition {
	name: string;
	displayName: string;
	description: string;
	type: "dark" | "light";
	tokens: Record<string, string>;
	isCustom?: boolean;
}

export function getThemesDir(workspace = process.cwd()): string {
	return path.join(workspace, ".pi", "themes");
}

export function getRuntimeThemesDir(workspace = process.cwd()): string {
	return path.join(workspace, ".learn-runtime", "themes");
}

export function getSettingsPath(workspace = process.cwd()): string {
	return path.join(workspace, ".learn-runtime", "settings.json");
}

/** Ensure local theme storage directories exist inside the workspace */
export function ensureThemeDirs(workspace = process.cwd()): void {
	const pThemes = getThemesDir(workspace);
	const rThemes = getRuntimeThemesDir(workspace);
	if (!fs.existsSync(pThemes)) fs.mkdirSync(pThemes, { recursive: true });
	if (!fs.existsSync(rThemes)) fs.mkdirSync(rThemes, { recursive: true });
}

/** Read the active theme name from the hermetic learning profile */
export function getActiveTheme(workspace = process.cwd()): string {
	const settingsPath = getSettingsPath(workspace);
	if (fs.existsSync(settingsPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
			if (typeof parsed.theme === "string" && parsed.theme.trim()) {
				return parsed.theme.trim();
			}
		} catch {
			// fallback
		}
	}
	return "dark";
}

/** Set the active theme in the isolated learning profile */
export function setActiveTheme(themeName: string, workspace = process.cwd()): boolean {
	const settingsPath = getSettingsPath(workspace);
	ensureThemeDirs(workspace);
	let settings: Record<string, any> = {};
	if (fs.existsSync(settingsPath)) {
		try {
			settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		} catch {
			settings = {};
		}
	}
	settings.theme = themeName.trim().toLowerCase();
	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	const tmpPath = `${settingsPath}.${Date.now()}.tmp`;
	fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
	fs.renameSync(tmpPath, settingsPath);
	return true;
}

/** Load all available themes from canonical .pi/themes and .learn-runtime/themes */
export function loadThemes(workspace = process.cwd()): ThemeDefinition[] {
	ensureThemeDirs(workspace);
	const themesMap = new Map<string, ThemeDefinition>();

	const scanDir = (dirPath: string, isCustomCandidate: boolean) => {
		if (!fs.existsSync(dirPath)) return;
		for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
			if (entry.isFile() && entry.name.endsWith(".json")) {
				try {
					const filePath = path.join(dirPath, entry.name);
					const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
					const name = (content.name || entry.name.replace(/\.json$/, "")).toLowerCase();
					const theme: ThemeDefinition = {
						name,
						displayName: content.displayName || content.name || name,
						description: content.description || "Custom study theme",
						type: content.type === "light" ? "light" : "dark",
						tokens: content.tokens || {},
						isCustom: isCustomCandidate || content.isCustom || !["dark", "light", "midnight", "editorial", "nord"].includes(name),
					};
					themesMap.set(name, theme);
				} catch {
					// Ignore invalid theme file
				}
			}
		}
	};

	scanDir(getThemesDir(workspace), false);
	scanDir(getRuntimeThemesDir(workspace), true);

	return Array.from(themesMap.values());
}

/** Add a new theme to the local learning ecosystem */
export function addTheme(
	theme: Partial<ThemeDefinition> & { name: string },
	workspace = process.cwd()
): ThemeDefinition {
	ensureThemeDirs(workspace);
	const id = theme.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
	if (!id) throw new Error("Theme name cannot be empty");

	const fullTheme: ThemeDefinition = {
		name: id,
		displayName: theme.displayName?.trim() || id,
		description: theme.description?.trim() || "Custom learning theme",
		type: theme.type === "light" ? "light" : "dark",
		tokens: theme.tokens && Object.keys(theme.tokens).length > 0 ? theme.tokens : {
			"--canvas": theme.type === "light" ? "#fbfbfb" : "#080808",
			"--canvas-tint": theme.type === "light" ? "#f3f4f6" : "#111111",
			"--grouped": theme.type === "light" ? "#ffffff" : "#111111",
			"--sheet": theme.type === "light" ? "#f9fafb" : "#181818",
			"--border": theme.type === "light" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)",
			"--border-strong": theme.type === "light" ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.28)",
			"--text": theme.type === "light" ? "#111827" : "#ffffff",
			"--text-secondary": theme.type === "light" ? "#4b5563" : "#c2c2c2",
			"--muted": theme.type === "light" ? "#6b7280" : "#999999",
			"--indigo": theme.type === "light" ? "#1f2937" : "#f4f4f4",
			"--indigo-hover": theme.type === "light" ? "#374151" : "#d6d6d6",
			"--indigo-soft": theme.type === "light" ? "#e5e7eb" : "#252525",
			"--sage": "#34d399",
			"--sage-soft": theme.type === "light" ? "#d1fae5" : "#16382d",
			"--danger": "#ff928a"
		},
		isCustom: true,
	};

	const pThemes = getThemesDir(workspace);
	const rThemes = getRuntimeThemesDir(workspace);

	const json = JSON.stringify(fullTheme, null, 2) + "\n";
	fs.writeFileSync(path.join(pThemes, `${id}.json`), json, "utf8");
	fs.writeFileSync(path.join(rThemes, `${id}.json`), json, "utf8");

	return fullTheme;
}

/** Remove a custom theme from the local learning ecosystem */
export function removeTheme(themeName: string, workspace = process.cwd()): boolean {
	const id = themeName.trim().toLowerCase();
	if (["dark", "light", "midnight", "editorial", "nord"].includes(id)) {
		throw new Error(`Cannot delete built-in theme '${id}'.`);
	}
	const pThemes = getThemesDir(workspace);
	const rThemes = getRuntimeThemesDir(workspace);
	let removed = false;

	const pFile = path.join(pThemes, `${id}.json`);
	if (fs.existsSync(pFile)) {
		fs.unlinkSync(pFile);
		removed = true;
	}
	const rFile = path.join(rThemes, `${id}.json`);
	if (fs.existsSync(rFile)) {
		fs.unlinkSync(rFile);
		removed = true;
	}

	if (getActiveTheme(workspace) === id) {
		setActiveTheme("dark", workspace);
	}
	return removed;
}
