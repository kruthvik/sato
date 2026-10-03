import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { SatoPaths } from "../../runtime/src/paths.ts";
import { createSatoPaths } from "../../runtime/src/paths.ts";
import { bootstrapSatoHome } from "../../runtime/src/bootstrap.ts";
import { loadInstalledPi, piInfo, PI_PACKAGE, piRuntimeRoot, piSelectionPath, readPiSelection, type PiSelection } from "./sdk.ts";
import { createTutorRuntime, type TutorBridge } from "./tutor.ts";

export interface PiUpdateOptions {
  install?: (directory: string, version: string) => Promise<void>;
}

async function withUpdateLock<T>(paths: SatoPaths, work: () => Promise<T>): Promise<T> {
  const root = piRuntimeRoot(paths);
  await mkdir(root, { recursive: true });
  const lockPath = join(root, "update.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(`Another Pi update may be running. If it has exited, inspect ${lockPath} before removing that lock.`);
  }
  try { await lock.writeFile(String(process.pid)); return await work(); }
  finally { await lock.close(); await unlink(lockPath); }
}

async function publishSelection(paths: SatoPaths, selection: PiSelection): Promise<void> {
  const temporary = join(piRuntimeRoot(paths), `selection-${randomUUID()}.json`);
  await writeFile(temporary, JSON.stringify(selection, null, 2), { flag: "wx", mode: 0o600 });
  await rename(temporary, piSelectionPath(paths));
}

async function installPi(directory: string, version: string): Promise<void> {
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "sato-isolated-pi", private: true, type: "module" }), { flag: "wx" });
  const child = Bun.spawn([process.execPath, "add", "--exact", "--ignore-scripts", `${PI_PACKAGE}@${version}`], { cwd: directory, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`Pi installation failed; active runtime unchanged.\n${(stderr || stdout).slice(-4000)}`);
}

async function checkCandidate(paths: SatoPaths, directory: string, version?: string): Promise<string> {
  const sdk = await loadInstalledPi(directory);
  if (version && sdk.VERSION !== version) throw new Error("Installed Pi version does not match the requested version; active runtime unchanged");
  // Exercise the actual tutor adapter, not just npm's install exit status. No
  // credentials, learner data, third-party extensions or provider calls are used.
  const probe = createSatoPaths({ home: join(directory, "compatibility-check", randomUUID()), applicationRoot: paths.applicationRoot, cwd: directory });
  await bootstrapSatoHome(probe);
  const bridge: TutorBridge = { operation: async () => ({ goal: null }), input: async () => {}, goal: async () => ({}), source: async () => [], approve: async () => ({}), calls: async () => { throw new Error("Compatibility checks must not call a model provider"); }, stop: async () => ({}), shutdown: async () => {} };
  const runtime = await createTutorRuntime(probe, bridge, sdk);
  try {
    const tools = runtime.session.getActiveToolNames().sort();
    if (tools.join() !== "learning_context,learning_define,learning_record,learning_source" || runtime.services.resourceLoader.getExtensions().errors.length || runtime.services.resourceLoader.getAgentsFiles().agentsFiles.length) throw new Error("Pi failed the isolated tutor compatibility check; active runtime unchanged");
  } finally { await runtime.dispose(); }
  return sdk.VERSION;
}

export async function updatePi(paths: SatoPaths, requested = "latest", options: PiUpdateOptions = {}) {
  if (requested !== "latest" && !/^1\.\d+\.\d+(?:-[\w.-]+)?$/.test(requested)) throw new Error("Use learn pi update [latest|1.x.y]. Breaking major versions require a Sato adapter update.");
  return withUpdateLock(paths, async () => {
    const previous = await readPiSelection(paths);
    const install = `install-${randomUUID()}`;
    const directory = join(piRuntimeRoot(paths), install);
    await mkdir(directory);
    await (options.install ?? installPi)(directory, requested);
    const version = await checkCandidate(paths, directory, requested === "latest" ? undefined : requested);
    await publishSelection(paths, { install, version, ...(previous ? { previous: { install: previous.install, version: previous.version } } : {}) });
    return { ...await piInfo(paths), activated: "next tutor launch", preserved: "learning data, credentials, settings, packages and older Pi installs" };
  });
}

export async function rollbackPi(paths: SatoPaths) {
  return withUpdateLock(paths, async () => {
    const current = await readPiSelection(paths);
    if (!current?.previous) throw new Error("No previous isolated runtime. Use learn pi reset for bundled Pi.");
    await checkCandidate(paths, join(piRuntimeRoot(paths), current.previous.install), current.previous.version);
    await publishSelection(paths, { ...current.previous, previous: { install: current.install, version: current.version } });
    return piInfo(paths);
  });
}

export async function resetPi(paths: SatoPaths) {
  return withUpdateLock(paths, async () => {
    // Archive instead of destroying the selection; works even for a corrupt
    // selection and never removes installed runtimes or learner data.
    try { await readFile(piSelectionPath(paths)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return piInfo(paths); throw error; }
    await rename(piSelectionPath(paths), join(piRuntimeRoot(paths), `selection-reset-${randomUUID()}.json`));
    return piInfo(paths);
  });
}
