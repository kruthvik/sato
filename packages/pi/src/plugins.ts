import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { SatoPaths } from "../../runtime/src/paths.ts";
import { loadPi, type PiSdk } from "./sdk.ts";

export function normalizePluginSource(paths: SatoPaths, source: string): string {
  return /^(npm:|git:|https?:)/.test(source) ? source : resolve(paths.cwd, source);
}

function managedNpmPath(paths: SatoPaths, source: string): string {
  const name = /^npm:((?:@[^/]+\/)?[^@/]+)(?:@.+)?$/.exec(source)?.[1];
  if (!name || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error(`Invalid npm Pi package: ${source}`);
  return join(paths.agent, "npm", "node_modules", name);
}

export async function ensureManagedPackages(paths: SatoPaths, sdk: PiSdk, settings: SettingsManager): Promise<void> {
  const manager = new sdk.DefaultPackageManager({ cwd: paths.config, agentDir: paths.agent, settingsManager: settings });
  for (const pkg of settings.getPackages()) {
    const source = typeof pkg === "string" ? pkg : pkg.source;
    if (!source.startsWith("npm:")) continue;
    const managed = managedNpmPath(paths, source);
    if (!existsSync(managed)) await manager.install(source);
    if (!existsSync(managed)) throw new Error(`Isolated package missing: ${source}. Sato will not load a global npm fallback.`);
  }
}

export async function managePlugin(paths: SatoPaths, action: string, source?: string, trusted = false): Promise<unknown> {
  if (!["list", "add", "remove", "update"].includes(action)) throw new Error("Usage: plugin list | add SOURCE --trust | remove SOURCE | update [SOURCE] --trust");
  const sdk = await loadPi(paths);
  const settings = sdk.SettingsManager.create(paths.config, paths.agent, { projectTrusted: false });
  const manager = new sdk.DefaultPackageManager({ cwd: paths.config, agentDir: paths.agent, settingsManager: settings });
  const configuredPackages = () => manager.listConfiguredPackages().map(pkg => {
    if (!pkg.source.startsWith("npm:")) return pkg;
    const managed = managedNpmPath(paths, pkg.source);
    return { ...pkg, installedPath: existsSync(managed) ? managed : undefined };
  });
  if (action === "list") return configuredPackages();
  if (action !== "update" && !source) throw new Error("Plugin source required");
  const normalized = source ? normalizePluginSource(paths, source) : undefined;
  if ((action === "add" || action === "update") && !trusted) throw new Error("Plugins can execute code with your OS privileges. Review their origin/tools/data access, then use --trust. Sources cannot grant permission to install plugins.");
  if (action === "add") await manager.installAndPersist(normalized!);
  if (action === "update") {
    await ensureManagedPackages(paths, sdk, settings);
    await manager.update(normalized);
  }
  let removed: boolean | undefined;
  if (action === "remove") {
    removed = await manager.removeAndPersist(normalized!);
    if (!/^(npm:|git:|https?:)/.test(normalized!)) {
      // A switched file package may now use native standalone registration.
      // Removing its source must also unregister that path, never delete it.
      const previous = settings.getExtensionPaths();
      const remaining = previous.filter(path => resolve(paths.agent, path.replace(/^[+!-]/, "")) !== normalized);
      if (remaining.length !== previous.length) { settings.setExtensionPaths(remaining); removed = true; }
    }
  }
  await settings.flush();
  return { action, source: normalized, removed, packages: configuredPackages(), permissions: "OS-level executable extensions; no sandbox. Installed extension tools are enabled; Pi's built-in coding tools remain off." };
}
