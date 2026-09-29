import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";

export interface PackageInfo {
	name: string;
	installed: boolean;
	isEssential: boolean;
	version?: string;
	description?: string;
}

export const ESSENTIAL_PACKAGES = [
	"npm:pi-subagents",
	"npm:@juicesharp/rpiv-ask-user-question",
	"npm:pi-web-search-and-fetch",
	"npm:pi-antigravity",
];

export const POPULAR_EXTENSIONS = [
	{ name: "npm:@narumitw/pi-plan-mode", description: "Structured multi-step planning and milestone tracking" },
	{ name: "npm:context-mode", description: "Context compression and token optimization for extended sessions" },
	{ name: "npm:@juicesharp/rpiv-todo", description: "Interactive task list manager for study objectives" },
	{ name: "npm:pi-zentui", description: "Distraction-free zen terminal UI mode for deep work" },
	{ name: "npm:pi-playwright", description: "Browser automation for testing and interactive visual validation" },
];

export function getRuntimeDir(workspace = process.cwd()): string {
	return path.join(workspace, ".learn-runtime");
}

export function getSettingsPath(workspace = process.cwd()): string {
	return path.join(workspace, ".learn-runtime", "settings.json");
}

export function getInstalledPackages(workspace = process.cwd()): PackageInfo[] {
	const settingsPath = getSettingsPath(workspace);
	const runtimeDir = getRuntimeDir(workspace);
	let packageNames: string[] = [];

	if (fs.existsSync(settingsPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
			if (Array.isArray(parsed.packages)) {
				packageNames = parsed.packages;
			}
		} catch {
			// fallback
		}
	}

	const results: PackageInfo[] = [];
	for (const pkg of packageNames) {
		const isEssential = ESSENTIAL_PACKAGES.includes(pkg);
		// Parse package folder name e.g. "npm:pi-subagents" -> "npm/node_modules/pi-subagents/package.json"
		const cleanName = pkg.startsWith("npm:") ? pkg.slice(4) : pkg;
		const manifestPath = path.join(runtimeDir, "npm", "node_modules", cleanName, "package.json");
		let installed = fs.existsSync(manifestPath);
		let version: string | undefined;
		let description: string | undefined;

		if (installed) {
			try {
				const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
				version = manifest.version;
				description = manifest.description;
			} catch {
				// manifest unreadable
			}
		}

		results.push({
			name: pkg,
			installed,
			isEssential,
			version,
			description,
		});
	}

	return results;
}

export function runPiCommand(args: string[], workspace = process.cwd()): { success: boolean; output: string } {
	const runtimeDir = getRuntimeDir(workspace);
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: runtimeDir,
	};

	try {
		const res = childProcess.spawnSync("pi", args, {
			cwd: workspace,
			env,
			encoding: "utf8",
			shell: true,
		});
		const output = (res.stdout || "") + (res.stderr || "");
		return {
			success: res.status === 0,
			output: output.trim(),
		};
	} catch (err: any) {
		return {
			success: false,
			output: err.message || String(err),
		};
	}
}

export function installPackage(pkg: string, workspace = process.cwd()): { success: boolean; output: string } {
	const clean = pkg.trim();
	if (!clean) return { success: false, output: "Package name cannot be empty." };
	const target = clean.startsWith("npm:") || clean.startsWith("git:") || clean.startsWith("http") ? clean : `npm:${clean}`;
	return runPiCommand(["install", target], workspace);
}

export function updatePackages(pkg?: string, workspace = process.cwd()): { success: boolean; output: string } {
	if (pkg && pkg.trim()) {
		return runPiCommand(["update", pkg.trim()], workspace);
	}
	return runPiCommand(["update", "--extensions"], workspace);
}

export function removePackage(pkg: string, workspace = process.cwd()): { success: boolean; output: string } {
	const clean = pkg.trim();
	if (!clean) return { success: false, output: "Package name cannot be empty." };
	return runPiCommand(["remove", clean], workspace);
}
