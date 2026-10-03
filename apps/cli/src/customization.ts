import type { SatoPaths } from "../../../packages/runtime/src/paths.ts";
import { bootstrapSatoHome } from "../../../packages/runtime/src/bootstrap.ts";
import { managePlugin } from "../../../packages/pi/src/plugins.ts";
import { manageResources } from "../../../packages/pi/src/resources.ts";
import { updatePi } from "../../../packages/pi/src/updates.ts";

type PackageAction = "add" | "remove" | "list" | "update";
type ResourceAction = "add" | "remove" | "list" | "enable" | "disable";
export type CustomizationCommand =
  | { kind: "package"; action: PackageAction; source?: string; trusted: boolean; json: boolean }
  | { kind: "extensions"; action: ResourceAction; path?: string; trusted: boolean; json: boolean }
  | { kind: "config"; json: boolean }
  | { kind: "engine"; json: boolean };

/** Pi's familiar verbs, with one scope: Sato's isolated home. */
export function parseCustomization(command: string | undefined, args: string[]): CustomizationCommand | undefined {
  if (!command || !["install", "remove", "uninstall", "list", "update", "extensions", "config"].includes(command)) return;
  const flags = args.filter(arg => arg.startsWith("-"));
  const allowed = ["--trust", "--json", ...(command === "update" ? ["--extensions"] : [])];
  for (const flag of flags) if (!allowed.includes(flag)) throw new Error(`Unsupported option ${flag}. These commands only configure Sato, never global Pi or invocation .pi settings.`);
  if (new Set(flags).size !== flags.length) throw new Error("Do not repeat command options");
  const positional = args.filter(arg => !arg.startsWith("-"));
  const json = flags.includes("--json"), trusted = flags.includes("--trust");
  if (command === "config") {
    if (positional.length || trusted) throw new Error("Usage: learn config [--json]. Use learn extensions enable|disable PATH to switch an extension.");
    return { kind: "config", json };
  }
  if (command === "extensions") {
    const action = positional[0] ?? "list";
    if (!["list", "add", "remove", "enable", "disable"].includes(action) || (action === "list" ? positional.length > 1 : positional.length !== 2)) throw new Error("Usage: learn extensions [list] | add|remove|enable|disable PATH [--trust] [--json]");
    if (trusted && action !== "add" && action !== "enable") throw new Error("--trust is only needed for adding or enabling extensions");
    return { kind: "extensions", action: action as ResourceAction, path: positional[1], trusted, json };
  }
  if (command === "list") {
    if (positional.length || trusted) throw new Error("Usage: learn list [--json]");
    return { kind: "package", action: "list", trusted: false, json };
  }
  if (command === "update" && !positional.length && !flags.includes("--extensions")) {
    if (trusted) throw new Error("Use learn update --extensions --trust to update packages, or learn update to update Pi");
    return { kind: "engine", json };
  }
  if (command === "update") {
    if (positional.length > 1 || (positional.length && flags.includes("--extensions"))) throw new Error("Usage: learn update | learn update --extensions --trust | learn update SOURCE --trust");
    return { kind: "package", action: "update", source: positional[0], trusted, json };
  }
  if (positional.length !== 1) throw new Error(`Usage: learn ${command} SOURCE${command === "install" ? " --trust" : ""} [--json]`);
  if (trusted && command !== "install") throw new Error("Removing a package does not require --trust");
  return { kind: "package", action: command === "install" ? "add" : "remove", source: positional[0], trusted, json };
}

const native = { bootstrap: bootstrapSatoHome, plugin: managePlugin, resources: manageResources, update: updatePi };
interface CustomizationOperations {
  bootstrap: typeof bootstrapSatoHome;
  plugin: (paths: SatoPaths, action: string, source?: string, trusted?: boolean) => Promise<unknown>;
  resources: (paths: SatoPaths, action: string, kind?: string, path?: string, trusted?: boolean) => Promise<unknown>;
  update: (paths: SatoPaths) => Promise<unknown>;
}
export async function executeCustomization(paths: SatoPaths, command: CustomizationCommand, operations: CustomizationOperations = native): Promise<unknown> {
  if (command.kind === "engine") return operations.update(paths);
  await operations.bootstrap(paths);
  if (command.kind === "package") return operations.plugin(paths, command.action, command.source, command.trusted);
  return operations.resources(paths, command.kind === "config" ? "list" : command.action, command.kind === "extensions" ? "extensions" : undefined, command.kind === "extensions" ? command.path : undefined, command.kind === "extensions" && command.trusted);
}

export function formatCustomization(command: CustomizationCommand, result: unknown): string {
  if (command.json) return JSON.stringify(result, null, 2);
  const value = result as Record<string, unknown>;
  if (command.kind === "engine") {
    return `Pi updated for Sato${value.version ? `: ${value.version}` : ""}. Global Pi is unchanged. Restart the tutor to use it.`;
  }
  if (command.kind === "package") {
    if (command.action === "list") {
      const packages = result as Array<{ source: string; installedPath?: string }>;
      return packages.length ? `Installed Pi packages (Sato only):\n${packages.map(pkg => `  ${/^(npm:|git:|https?:)/.test(pkg.source) ? pkg.source : pkg.installedPath ?? pkg.source}${pkg.installedPath ? "" : " (not installed)"}`).join("\n")}\nUse learn extensions to see loaded extensions.` : "No Pi packages installed. Add one with learn install SOURCE --trust.";
    }
    const source = value.source ?? command.source ?? "all packages";
    if (command.action === "remove" && value.removed === false) return `Package not configured: ${source}`;
    return `${command.action === "add" ? "Installed" : command.action === "remove" ? "Removed" : "Updated"}: ${source}\nApplies on the next launch or /reload. Global Pi is unchanged.`;
  }
  if (command.kind === "extensions" && command.action !== "list") return `${command.action === "disable" ? "Disabled" : command.action === "enable" ? "Enabled" : command.action === "add" ? "Registered" : "Unregistered"}: ${value.path}\nApplies on the next launch or /reload. Files are not deleted.${command.action === "remove" ? " Auto-discovered/packaged extensions must be disabled to stop loading." : ""}`;
  const extensions = (value.extensions ?? []) as string[];
  const lines = [command.kind === "config" ? "Sato configuration (global Pi is unchanged):" : "Loaded extensions (Sato only):", ...extensions.map(path => `  ${path}`)];
  if (!extensions.length) lines.push("  No user extensions loaded.");
  if (command.kind === "config") {
    for (const kind of ["skills", "prompts", "themes"]) {
      const entries = (value[kind] ?? []) as Array<{ name: string; path?: string }>;
      lines.push(`${kind}: ${entries.length ? entries.map(entry => entry.name).join(", ") : "none"}`);
    }
    lines.push("Use learn extensions enable|disable PATH; learn theme list; /settings in the tutor.");
  }
  const errors = (value.errors ?? []) as Array<{ path: string; error: string }>;
  for (const error of errors) lines.push(`Error loading ${error.path}: ${error.error}`);
  for (const diagnostic of (value.diagnostics ?? []) as Array<{ type: string; message: string; path?: string }>) lines.push(`${diagnostic.type}: ${diagnostic.message}${diagnostic.path ? ` (${diagnostic.path})` : ""}`);
  lines.push("Sato's learning tools and planner are built in, not removable packages.");
  return lines.join("\n");
}
