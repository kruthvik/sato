import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SatoPaths } from "../../runtime/src/paths.ts";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";
export type PiSdk = typeof import("@earendil-works/pi-coding-agent");
export interface PiSelection { install: string; version: string; previous?: { install: string; version: string } }

export function piRuntimeRoot(paths: SatoPaths): string { return join(paths.home, "pi-runtime"); }
export function piSelectionPath(paths: SatoPaths): string { return join(piRuntimeRoot(paths), "active.json"); }

// Select only immutable installs created by Sato, never global Pi or arbitrary entrypoints.
export function validateSelection(value: unknown): asserts value is PiSelection {
  const check = (entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid Pi runtime selection");
    const { install, version } = entry as PiSelection;
    if (typeof install !== "string" || !/^install-[a-f0-9-]{36}$/.test(install) || typeof version !== "string" || !/^1\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("Invalid Pi runtime selection; run learn pi reset to use bundled Pi");
  };
  check(value);
  const previous = (value as PiSelection).previous;
  if (previous !== undefined) check(previous);
}

export async function readPiSelection(paths: SatoPaths): Promise<PiSelection | undefined> {
  let content: string;
  try { content = await readFile(piSelectionPath(paths), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const selection: unknown = JSON.parse(content);
  validateSelection(selection);
  return selection;
}

export function validatePiSdk(sdk: PiSdk): void {
  // Breaking major upgrades require an adapter review, not a silent cast to compatibility.
  if (!/^1\./.test(sdk.VERSION ?? "")) throw new Error(`Unsupported Pi ${sdk.VERSION ?? "unknown"}; Sato currently supports Pi 1.x`);
  for (const name of ["createAgentSession", "createAgentSessionServices", "createAgentSessionFromServices", "createAgentSessionRuntime", "SettingsManager", "SessionManager", "DefaultResourceLoader", "DefaultPackageManager", "InteractiveMode", "BorderedLoader", "loadSkills"] as const) {
    if (typeof sdk[name] !== "function") throw new Error(`Pi SDK is missing ${name}; previous runtime remains active`);
  }
}

export async function loadInstalledPi(directory: string): Promise<PiSdk> {
  const manifest = JSON.parse(await readFile(join(directory, "node_modules", PI_PACKAGE, "package.json"), "utf8")) as { name?: string; version?: string };
  if (manifest.name !== PI_PACKAGE) throw new Error("Isolated install is not the Pi package");
  // Resolve using import conditions. Pi intentionally has an ESM-only export;
  // createRequire().resolve() cannot resolve that export on Bun/Node.
  const entry = import.meta.resolve(PI_PACKAGE, join(directory, "package.json"));
  const sdk = await import(entry.startsWith("file:") ? entry : pathToFileURL(entry).href) as PiSdk;
  validatePiSdk(sdk);
  if (manifest.version !== sdk.VERSION) throw new Error("Installed Pi manifest and SDK versions disagree");
  return sdk;
}

export async function loadPi(paths: SatoPaths): Promise<PiSdk> {
  const selection = await readPiSelection(paths);
  if (!selection) {
    const sdk = await import("@earendil-works/pi-coding-agent");
    validatePiSdk(sdk);
    return sdk;
  }
  const sdk = await loadInstalledPi(join(piRuntimeRoot(paths), selection.install));
  if (sdk.VERSION !== selection.version) throw new Error("Selected Pi version does not match its installed SDK; run learn pi reset or update");
  return sdk;
}

export async function piInfo(paths: SatoPaths) {
  const selection = await readPiSelection(paths);
  const sdk = await loadPi(paths);
  return { version: sdk.VERSION, source: selection ? "isolated" : "bundled", supported: "1.x", runtime: selection ? join(piRuntimeRoot(paths), selection.install) : "Sato package dependency", previous: selection?.previous ?? null, agent: paths.agent, sessions: paths.sessions, global_pi: "not modified" };
}
