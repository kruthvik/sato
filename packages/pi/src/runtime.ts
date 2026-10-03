import { homedir } from "node:os";
import { readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DefaultResourceLoader, ResourceLoader, SettingsManager, CreateAgentSessionOptions, CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";
import type { DisposableRuntime } from "../../core/src/index.ts";
import type { SatoPaths } from "../../runtime/src/paths.ts";
import { loadPi, type PiSdk } from "./sdk.ts";
import { ensureManagedPackages } from "./plugins.ts";

type SatoResourceOptions = Omit<ConstructorParameters<typeof DefaultResourceLoader>[0], "cwd" | "agentDir" | "settingsManager">;

export interface PiRuntimeOptions {
  createSession?: (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>;
}

export function createSatoSettings(paths: SatoPaths, sdk: PiSdk): SettingsManager {
  // The project scope is a Sato-owned location; never load invocation .pi/settings.json.
  const settings = sdk.SettingsManager.create(paths.config, paths.agent, { projectTrusted: false });
  if (settings.getGlobalSettings().enableInstallTelemetry === undefined) settings.setEnableInstallTelemetry(false);
  return settings;
}

export async function createSatoResourceLoader(paths: SatoPaths, settingsManager?: SettingsManager, sdk?: PiSdk, extra: SatoResourceOptions = {}): Promise<DefaultResourceLoader> {
  const pi = sdk ?? await loadPi(paths);
  const settings = settingsManager ?? createSatoSettings(paths, pi);
  const loader = new pi.DefaultResourceLoader({
    cwd: paths.config,
    agentDir: paths.agent,
    settingsManager: settings,
    ...createSatoResourceOptions(paths, settings, pi),
    ...extra,
  });
  guardSatoResourceLoader(loader, paths, pi, settings);
  return loader;
}

export function guardSatoResourceLoader(loader: ResourceLoader, paths: SatoPaths, pi: PiSdk, settings: SettingsManager): void {
  const reload = loader.reload.bind(loader);
  loader.reload = async options => {
    // Native Pi has a legacy global npm fallback. Always provision managed
    // copies first, including on /reload, without modifying global installs.
    await settings.flush();
    await settings.reload();
    await ensureManagedPackages(paths, pi, settings);
    await reload(options);
  };
}

export function createSatoResourceOptions(paths: SatoPaths, settings?: SettingsManager, sdk?: PiSdk): SatoResourceOptions {
  // Pi treats an explicitly supplied empty extension directory as an importable
  // module. Supply concrete entries instead; normal user/package discovery stays native.
  let extensionPaths: string[] = [];
  try {
    extensionPaths = readdirSync(paths.builtIn.extensions, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith(".") && (entry.isDirectory() || /\.(ts|js|mjs)$/.test(entry.name)))
      .map(entry => join(paths.builtIn.extensions, entry.name));
  } catch {}
  const skillAllowed = (filePath: string): boolean => {
    const relativePath = relative(join(process.env.HOME || homedir(), ".agents", "skills"), filePath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return true;
    // Literal paths explicitly opted into in Sato settings are intentional
    // sharing, unlike automatic ambient discovery.
    const configured = [...(settings?.getSkillPaths() ?? []), ...(settings?.getPackages() ?? []).flatMap(pkg => typeof pkg === "string" ? [pkg] : pkg.skills?.length === 0 ? [] : [pkg.source])];
    return configured.some(input => {
      if (/^[!-]|^(npm:|git:|https?:|builtin:)/.test(input)) return false;
      const value = input.replace(/^\+/, "").replace(/^~(?=[/\\]|$)/, process.env.HOME || homedir());
      const candidate = resolve(paths.agent, value);
      const child = relative(candidate, filePath);
      return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
    });
  };
  return {
    additionalExtensionPaths: extensionPaths,
    additionalSkillPaths: [paths.builtIn.skills],
    additionalPromptTemplatePaths: [paths.builtIn.prompts],
    additionalThemePaths: [paths.builtIn.themes],
    noContextFiles: true,
    // Pi also auto-discovers ~/.agents/skills independently of agentDir. That
    // general user location must not leak into Sato's isolated environment.
    skillsOverride: ({ skills, diagnostics }) => {
      const selected = skills.filter(skill => skillAllowed(skill.filePath));
      // Pi deduplicates names before this override. Recover a Sato skill that
      // was shadowed by an excluded ambient skill, using Pi's public parser.
      const recoveryPaths = diagnostics.flatMap(d => d.collision && !skillAllowed(d.collision.winnerPath) && skillAllowed(d.collision.loserPath) ? [d.collision.loserPath] : []);
      const recovered = sdk && recoveryPaths.length ? sdk.loadSkills({ cwd: paths.config, agentDir: paths.agent, skillPaths: recoveryPaths, includeDefaults: false }) : { skills: [], diagnostics: [] };
      const names = new Set(selected.map(skill => skill.name));
      for (const skill of recovered.skills) if (!names.has(skill.name)) { selected.push(skill); names.add(skill.name); }
      return {
        skills: selected,
        diagnostics: [...diagnostics, ...recovered.diagnostics].filter(d => (!d.path || skillAllowed(d.path)) && (!d.collision || (skillAllowed(d.collision.winnerPath) && skillAllowed(d.collision.loserPath)))),
      };
    },
  };
}

export async function createSatoPiRuntime(paths: SatoPaths, options: PiRuntimeOptions = {}): Promise<DisposableRuntime> {
  const sdk = await loadPi(paths);
  const settingsManager = createSatoSettings(paths, sdk);
  const resourceLoader = await createSatoResourceLoader(paths, settingsManager, sdk);
  await resourceLoader.reload();
  try {
    const { session } = await (options.createSession ?? sdk.createAgentSession)({
      cwd: paths.cwd,
      agentDir: paths.agent,
      settingsManager,
      resourceLoader,
      sessionManager: sdk.SessionManager.create(paths.cwd, paths.sessions),
    });
    return { dispose: async () => { session.dispose(); await settingsManager.flush(); } };
  } catch (error) {
    throw new Error("Unable to initialize Pi runtime", { cause: error });
  }
}
