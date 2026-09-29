import * as fs from "node:fs";
import * as path from "node:path";

export interface Integration {
	id: string;
	name: string;
	category: string;
	enabled: boolean;
	scriptUrl?: string;
	description: string;
	settings: Record<string, unknown>;
}

export interface IntegrationsConfig {
	version: number;
	integrations: Integration[];
}

let cachedConfig: IntegrationsConfig | null = null;
let cachedMtime = 0;
let cachedPath = "";

function configPath(cwd = process.cwd()): string {
	return path.join(cwd, "_learning", "config", "integrations.json");
}

export function loadIntegrationsConfig(cwd = process.cwd()): IntegrationsConfig {
	const p = configPath(cwd);
	if (!fs.existsSync(p)) {
		return { version: 1, integrations: [] };
	}
	try {
		const stat = fs.statSync(p);
		if (cachedConfig && cachedPath === p && stat.mtimeMs === cachedMtime) {
			return cachedConfig;
		}
		const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as IntegrationsConfig;
		cachedConfig = parsed;
		cachedMtime = stat.mtimeMs;
		cachedPath = p;
		return parsed;
	} catch {
		return { version: 1, integrations: [] };
	}
}

export function saveIntegrationsConfig(config: IntegrationsConfig, cwd = process.cwd()): void {
	const p = configPath(cwd);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	const tmpPath = `${p}.${Date.now()}.tmp`;
	fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf8");
	fs.renameSync(tmpPath, p);

	cachedConfig = config;
	cachedPath = p;
	try {
		cachedMtime = fs.statSync(p).mtimeMs;
	} catch {
		cachedMtime = Date.now();
	}
}

export function getIntegrations(cwd = process.cwd()): Integration[] {
	return loadIntegrationsConfig(cwd).integrations;
}

export function isIntegrationEnabled(id: string, cwd = process.cwd()): boolean {
	const list = getIntegrations(cwd);
	const found = list.find((item) => item.id === id);
	return Boolean(found?.enabled);
}

export function toggleIntegration(id: string, enabled?: boolean, cwd = process.cwd()): Integration | null {
	const config = loadIntegrationsConfig(cwd);
	const item = config.integrations.find((i) => i.id === id);
	if (!item) return null;
	item.enabled = enabled !== undefined ? enabled : !item.enabled;
	saveIntegrationsConfig(config, cwd);
	return item;
}

export function updateIntegration(id: string, updates: Partial<Integration>, cwd = process.cwd()): Integration | null {
	const config = loadIntegrationsConfig(cwd);
	const item = config.integrations.find((i) => i.id === id);
	if (!item) return null;
	if (updates.name) item.name = updates.name.trim();
	if (updates.category) item.category = updates.category.trim();
	if (updates.description) item.description = updates.description.trim();
	if (updates.scriptUrl !== undefined) item.scriptUrl = updates.scriptUrl.trim();
	if (typeof updates.enabled === "boolean") item.enabled = updates.enabled;
	if (updates.settings) item.settings = { ...item.settings, ...updates.settings };
	saveIntegrationsConfig(config, cwd);
	return item;
}

export function addIntegration(entry: Omit<Integration, "enabled"> & { enabled?: boolean }, cwd = process.cwd()): Integration {
	const config = loadIntegrationsConfig(cwd);
	const existingIdx = config.integrations.findIndex((i) => i.id === entry.id);
	const clean: Integration = {
		id: entry.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
		name: entry.name.trim(),
		category: entry.category.trim() || "General",
		enabled: entry.enabled ?? true,
		scriptUrl: entry.scriptUrl?.trim(),
		description: entry.description.trim(),
		settings: entry.settings || {},
	};
	if (existingIdx >= 0) {
		config.integrations[existingIdx] = clean;
	} else {
		config.integrations.push(clean);
	}
	saveIntegrationsConfig(config, cwd);
	return clean;
}
