import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { SatoPaths } from "../../runtime/src/paths.ts";
import { loadPi } from "./sdk.ts";
import { createSatoResourceLoader, createSatoSettings } from "./runtime.ts";

const accessors = {
  extensions: ["getExtensionPaths", "setExtensionPaths"],
  skills: ["getSkillPaths", "setSkillPaths"],
  prompts: ["getPromptTemplatePaths", "setPromptTemplatePaths"],
  themes: ["getThemePaths", "setThemePaths"],
} as const;
type ResourceKind = keyof typeof accessors;
function resourceKind(value?: string): ResourceKind {
  if (!value || !Object.hasOwn(accessors, value)) throw new Error("Resource kind must be extensions, skills, prompts or themes");
  return value as ResourceKind;
}
function configured(settings: SettingsManager) {
  return Object.fromEntries(Object.entries(accessors).map(([kind, [get]]) => [kind, settings[get]()]));
}

export async function manageResources(paths: SatoPaths, action: string, kind?: string, input?: string, trusted = false) {
  if (!["list", "add", "remove", "enable", "disable"].includes(action)) throw new Error("Usage: learn resource list | add|remove|enable|disable KIND PATH [--trust]");
  const sdk = await loadPi(paths);
  const settings = createSatoSettings(paths, sdk);
  if (action === "list") {
    const loader = await createSatoResourceLoader(paths, settings, sdk);
    await loader.reload();
    return { configured: configured(settings), extensions: loader.getExtensions().extensions.map(e => e.path), skills: loader.getSkills().skills.map(s => ({ name: s.name, path: s.filePath })), prompts: loader.getPrompts().prompts.map(p => ({ name: p.name, path: p.filePath })), themes: loader.getThemes().themes.map(t => ({ name: t.name, path: t.sourcePath })), errors: loader.getExtensions().errors, diagnostics: [...loader.getSkills().diagnostics, ...loader.getPrompts().diagnostics, ...loader.getThemes().diagnostics] };
  }
  const key = resourceKind(kind);
  if (!input) throw new Error("Resource path required");
  if (key === "extensions" && ["add", "enable"].includes(action) && !trusted) throw new Error("Extensions execute with OS privileges. Review the code, then use --trust.");
  const path = resolve(paths.cwd, input);
  if (["add", "enable"].includes(action) && !existsSync(path)) throw new Error(`Resource does not exist: ${path}`);
  const [get, set] = accessors[key];
  const existing = settings[get]().filter(p => resolve(paths.agent, p.replace(/^[+!-]/, "")) !== path);
  let packaged = false;
  let migratedFile = false;
  if (action === "enable" || action === "disable") {
    // Pi stores packaged-resource switches in packages[].KIND, not in the
    // top-level path list. Preserve all other native manifest/filter fields.
    const manager = new sdk.DefaultPackageManager({ cwd: paths.config, agentDir: paths.agent, settingsManager: settings });
    const packages = settings.getPackages().filter(pkg => {
      const source = typeof pkg === "string" ? pkg : pkg.source;
      const root = manager.getInstalledPath(source, "user");
      if (key === "extensions" && root && resolve(root) === path && statSync(root).isFile()) {
        // Pi's file-package branch ignores package resource filters. Move this
        // one registration to native standalone switches before it can load.
        migratedFile = true;
        return false;
      }
      return true;
    }).map(pkg => {
      const source = typeof pkg === "string" ? pkg : pkg.source;
      const root = manager.getInstalledPath(source, "user");
      if (!root) return pkg;
      const child = relative(root, path);
      if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) return pkg;
      packaged = true;
      const entry = typeof pkg === "string" ? { source } : { ...pkg };
      const previous = entry[key];
      if (action === "disable" && previous?.length === 0) return entry;
      const target = child.replaceAll("\\", "/") || ".";
      const filters = (previous ?? []).filter(p => !(/^[+-]/.test(p) && p.slice(1).replaceAll("\\", "/") === target));
      filters.push(`${action === "disable" ? "-" : previous?.length === 0 ? "" : "+"}${target}`);
      entry[key] = filters;
      return entry;
    });
    if (packaged || migratedFile) settings.setPackages(packages);
  }
  if (action !== "remove" && !packaged) {
    // Explicit external paths need a plain discovery entry as well as their
    // switch. A lone +PATH/-PATH cannot discover a non-auto-loaded resource.
    existing.push(path);
    if (action === "enable" || action === "disable") existing.push(`${action === "disable" ? "-" : "+"}${path}`);
  }
  settings[set](existing);
  await settings.flush();
  return { action, kind: key, path, configured: configured(settings), packages: settings.getPackages(), ...(migratedFile ? { registration: "File package moved to Pi's native standalone extension switches" } : {}), applies: "next launch or /reload", note: "Files are not deleted. Use disable to turn off auto-discovered or packaged resources." };
}

export async function manageTheme(paths: SatoPaths, action = "list", name?: string) {
  if (!["list", "set"].includes(action)) throw new Error("Usage: learn theme list | set NAME");
  const sdk = await loadPi(paths);
  const settings = createSatoSettings(paths, sdk);
  const loader = await createSatoResourceLoader(paths, settings, sdk);
  await loader.reload();
  const themes = [...new Set(["system", "dark", "light", ...loader.getThemes().themes.map(theme => theme.name)])];
  if (action === "set") {
    if (!name || !themes.includes(name)) throw new Error(`Unknown theme. Available: ${themes.join(", ")}`);
    settings.setTheme(name);
    await settings.flush();
  }
  return { selected: settings.getThemeSetting() ?? "system", themes, diagnostics: loader.getThemes().diagnostics, applies: "next launch; native /settings changes the current terminal" };
}
