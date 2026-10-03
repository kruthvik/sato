#!/usr/bin/env bun
import { createSatoPaths, inspectSatoResources } from "../../../packages/runtime/src/index.ts";
import { bootstrapSatoHome } from "../../../packages/runtime/src/bootstrap.ts";
import { LearningService } from "../../../packages/runtime/src/service.ts";
import { launchTutor, readBrain, sourceControl } from "../../../packages/runtime/src/tutor-host.ts";
import { backup, restore } from "../../../packages/runtime/src/backup.ts";
import { runOfflineDemo } from "../../../packages/activities/src/demo.ts";
import { managePlugin } from "../../../packages/pi/src/plugins.ts";
import { piInfo } from "../../../packages/pi/src/sdk.ts";
import { resetPi, rollbackPi, updatePi } from "../../../packages/pi/src/updates.ts";
import { manageResources, manageTheme } from "../../../packages/pi/src/resources.ts";
import { projectComponents } from "../../../packages/storage/src/projection.ts";
import { formatLearningStatus } from "../../../packages/core/src/status.ts";
import { open, readFile, writeFile } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseCustomization, executeCustomization, formatCustomization } from "./customization.ts";

const paths = createSatoPaths({ home: process.env.SATO_HOME });
// Pi's terminal helpers (keybindings, diagnostics and theme watcher) still use
// the native environment root. Override it in this process before loading Pi.
process.env.PI_CODING_AGENT_DIR = paths.agent;
let service: LearningService | undefined;

const usage = `Sato · Pi's native terminal, focused on learning\n\nlearn                              Open the tutor\nlearn install SOURCE --trust       Add a Pi package or local extension file\nlearn remove SOURCE                Remove a package (uninstall is an alias)\nlearn list                         List installed packages\nlearn update                       Update Pi for Sato only\nlearn update --extensions --trust   Update installed packages\nlearn update SOURCE --trust         Update one package\nlearn extensions                   List loaded extensions\nlearn extensions enable PATH --trust | disable PATH\nlearn config                       Show extensions, skills, prompts and themes\nlearn theme list | set NAME         Choose a theme\nlearn status                       Show your learning progress\nlearn demo                         Try an offline lesson\nlearn doctor                       Check setup\nlearn --version                    Show the selected Pi version\nlearn help --all                   Show advanced commands\n\nInside the tutor: /login, /model, /learn, /exam, /status, /settings, /reload, /stop, /quit.\nInstall sources: npm:PACKAGE, git:REPOSITORY, or a local path.\nExtensions have OS privileges; review their code before using --trust.\nSATO_HOME defaults to ~/.learn. Global Pi is unchanged.\n`;

const advancedUsage = `${usage}\nAdvanced commands (existing aliases remain supported):\nlearn init\nlearn source add PATH | list | preview ID | accept ID | remove ID\nlearn brain show | edit\nlearn pi info | update [VERSION] | rollback | reset\nlearn plugin list | add SOURCE --trust | remove SOURCE | update [SOURCE] --trust\nlearn resource list | add|remove|enable|disable KIND PATH [--trust]\nlearn extensions add PATH --trust | remove PATH\nlearn export FILE | backup FILE | restore FILE\nlearn --smoke [--debug]\n\nCustomization commands accept --json for scripting.\nPDF/OCR, audio and simulations are deferred.\n`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set(args);
  if (flags.has("--help") || args[0] === "help" || flags.has("-h")) { console.log(flags.has("--all") ? advancedUsage : usage); return; }
  if (flags.has("--version") || flags.has("-v")) {
    if (args.length !== 1) throw new Error("Usage: learn --version");
    const info = await piInfo(paths); console.log(`Sato · Pi ${info.version} (${info.source})`); return;
  }
  if (flags.has("--debug")) {
    console.log(`Application root: ${paths.applicationRoot}\nSato home: ${paths.home}\nInvocation directory: ${paths.cwd}\nPi agent root: ${paths.agent}\nSession root: ${paths.sessions}`);
  }
  if (flags.has("--smoke")) {
    if (args.some(a => !["--smoke", "--debug"].includes(a))) throw new Error(usage);
    const resources = await inspectSatoResources(paths);
    if (resources.errors.length || resources.diagnostics.some(d => d.type === "error")) throw new Error(`Resource smoke check failed: ${JSON.stringify({ errors: resources.errors, diagnostics: resources.diagnostics })}`);
    console.log(`Sato resource smoke test passed (skills: ${resources.skills}, prompts: ${resources.prompts}, themes: ${resources.themes}).`);
    return;
  }
  const [command, ...rest] = args.filter(a => a !== "--debug");
  const customization = parseCustomization(command, rest);
  if (customization) {
    if (customization.kind === "engine") console.error("Updating Pi in Sato's home. Global Pi and learning records are unchanged.");
    console.log(formatCustomization(customization, await executeCustomization(paths, customization)));
    return;
  }
  if (command === "demo") {
    if (rest.length && (rest[0] !== "--answers" || !rest[1] || rest.length !== 2)) throw new Error("Usage: learn demo [--answers 5,7,9]");
    await runOfflineDemo(rest[0] === "--answers" ? rest[1]!.split(",") : undefined);
    return;
  }
  if (command === "restore") {
    if (rest.length !== 1) throw new Error("Usage: learn restore FILE (in a fresh SATO_HOME)");
    await restore(paths, resolve(rest[0]!));
    console.log("Restored verified database and originals. Provider credentials and Pi transcripts are not part of educational backups.");
    return;
  }
  if (command === "pi") {
    const action = rest[0] ?? "info";
    if (!(["info", "update", "rollback", "reset"].includes(action)) || rest.length > (action === "update" ? 2 : 1)) throw new Error("Usage: learn pi info | update [latest|1.x.y] | rollback | reset");
    if (action === "update") console.error("Installing Pi in Sato's home and checking native tutor startup. Global Pi and learning records are unchanged.");
    console.log(JSON.stringify(action === "info" ? await piInfo(paths) : action === "update" ? await updatePi(paths, rest[1]) : action === "rollback" ? await rollbackPi(paths) : await resetPi(paths), null, 2));
    return;
  }
  await bootstrapSatoHome(paths);
  if (command === "plugin") {
    const positional = rest.filter(arg => arg !== "--trust");
    const action = positional[0] ?? "list";
    if (positional.length > 2 || (action === "list" && positional.length > 1)) throw new Error("Usage: learn plugin list | add SOURCE --trust | remove SOURCE | update [SOURCE] --trust");
    console.log(JSON.stringify(await managePlugin(paths, action, positional[1], rest.includes("--trust")), null, 2));
    return;
  }
  if (command === "resource") {
    const positional = rest.filter(arg => arg !== "--trust");
    if (positional.length > 3 || (positional[0] === "list" && positional.length > 1)) throw new Error("Usage: learn resource list | add|remove|enable|disable KIND PATH [--trust]");
    console.log(JSON.stringify(await manageResources(paths, positional[0] ?? "list", positional[1], positional[2], rest.includes("--trust")), null, 2));
    return;
  }
  if (command === "theme") {
    if (rest.length > 2 || (rest[0] === "list" && rest.length > 1)) throw new Error("Usage: learn theme list | set NAME");
    console.log(JSON.stringify(await manageTheme(paths, rest[0], rest[1]), null, 2));
    return;
  }
  service = new LearningService(paths);
  if (command === "init") { console.log(`Sato initialized at ${paths.home}. Run learn, then /login, /model, and /learn or /exam. Use learn demo for an offline lesson.`); return; }
  if (command === "doctor") {
    const resources = await inspectSatoResources(paths);
    const integrity = service.store.integrity();
    const foreignKeyErrors = service.store.db.query("PRAGMA foreign_key_check").all();
    const missingBlobs: string[] = [];
    for (const blob of service.store.db.query<{ hash: string }, []>("SELECT hash FROM blob_manifest").all()) {
      const bytes = await readFile(join(paths.data, "blobs", blob.hash)).catch(() => undefined);
      if (!bytes || new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== blob.hash) missingBlobs.push(blob.hash);
    }
    const authExists = await Bun.file(join(paths.agent, "auth.json")).exists();
    console.log(JSON.stringify({ bun: Bun.version, pi: await piInfo(paths), resources, sqlite: integrity, foreign_key_errors: foreignKeyErrors, missing_originals: missingBlobs, provider_auth_file: authExists ? "present (secrets not inspected)" : "not configured; use /login or provider environment variables", provider_logging: "Observed provider hooks; unobservable retry/compaction/stream correlation is reported as unknown", isolation: { agent: paths.agent, sessions: paths.sessions, invocation_context_discovery: "disabled" } }, null, 2));
    if (integrity.join() !== "ok" || missingBlobs.length || foreignKeyErrors.length) throw new Error("Doctor found a storage integrity problem");
    if (resources.errors.length || resources.diagnostics.some(d => d.type === "error")) throw new Error("Doctor found resource configuration errors; inspect the diagnostics above");
    return;
  }
  if (command === "status") { const context = await service.context({}, "cli"); console.log(rest[0] === "--json" ? JSON.stringify(context, null, 2) : formatLearningStatus(context)); return; }
  if (command === "source") { console.log(JSON.stringify(await sourceControl(service, rest.join(" ")), null, 2)); return; }
  if (command === "brain") {
    if (rest[0] === "show") { console.log(await readBrain(paths)); return; }
    if (rest[0] === "edit") { const editor = process.env.EDITOR || (process.platform === "win32" ? "notepad.exe" : "vi"); const child = Bun.spawn([editor, paths.brain], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }); if (await child.exited !== 0) throw new Error("Editor failed"); return; }
    throw new Error("Usage: learn brain show|edit");
  }
  if (command === "backup" || command === "export") {
    if (rest.length !== 1) throw new Error(`Usage: learn ${command} FILE`);
    if (command === "backup") await backup(service.store, paths, rest[0]!);
    else {
      const content = { format: "sato-private-export-v1", goal: service.store.currentGoal(), revisions: service.store.revisions(), events: service.store.events(), observations: projectComponents(service.store, service.store.throughSeq, service.store.now()), model_calls: service.store.db.query("SELECT * FROM model_call_log ORDER BY seq").all(), warning: "Private local export includes responses and keys. Unknown source rights do not authorize public sharing." };
      await writeFile(resolve(rest[0]!), JSON.stringify(content, null, 2), { flag: "wx", mode: 0o600 });
    }
    console.log(`${command === "backup" ? "Backup" : "Private export"} written to ${resolve(rest[0]!)}. No provider credentials included.`);
    return;
  }
  if (command) throw new Error(usage);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive tutor requires a terminal. Use learn demo --answers 5,7,9, learn status or learn doctor for noninteractive checks.");
  const lockPath = join(paths.home, "tutor.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch { throw new Error(`Another tutor may be running. If it has exited, inspect and remove ${lockPath} before restarting.`); }
  await lock.writeFile(String(process.pid));
  await lock.close();
  const release = () => { try { unlinkSync(lockPath); } catch {} };
  process.once("exit", release);
  try { await launchTutor(paths, service); }
  finally { process.off("exit", release); release(); }
}

try {
  await main();
} catch (error) {
  console.error(`Sato: ${error instanceof Error ? error.message : String(error)}`);
  if (process.env.SATO_DEBUG === "1") console.error(error);
  process.exitCode = 1;
} finally {
  service?.close();
}
