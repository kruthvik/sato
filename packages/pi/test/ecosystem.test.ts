import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSatoPaths, installedApplicationRoot } from "../../runtime/src/paths.ts";
import { bootstrapSatoHome } from "../../runtime/src/bootstrap.ts";
import { managePlugin, ensureManagedPackages } from "../src/plugins.ts";
import { manageResources, manageTheme } from "../src/resources.ts";
import { createTutorRuntime, type TutorBridge } from "../src/tutor.ts";
import { loadPi, piInfo, PI_PACKAGE, piRuntimeRoot, piSelectionPath, readPiSelection, validatePiSdk, type PiSdk } from "../src/sdk.ts";
import { resetPi, rollbackPi, updatePi } from "../src/updates.ts";
import { createSatoResourceLoader, createSatoResourceOptions, createSatoSettings } from "../src/runtime.ts";
import { guardSatoResourceLoader } from "../src/runtime.ts";
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sato-ecosystem-")); roots.push(root);
  const paths = createSatoPaths({ home: join(root, "sato"), cwd: root });
  await bootstrapSatoHome(paths);
  return { root, paths };
}
const bridge: TutorBridge = { operation: async () => ({ goal: null }), input: async () => {}, goal: async () => ({}), source: async () => [], approve: async () => ({}), calls: async () => { throw new Error("No provider calls in ecosystem tests"); }, stop: async () => ({}), shutdown: async () => {} };
const extension = `export default function(pi) {
  pi.registerTool({ name: "fixture_tool", label: "Fixture", description: "An installed extension tool", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "works" }], details: {} }) });
  pi.registerCommand("fixture-command", { description: "An installed command", handler: async () => {} });
}`;

test("native package add exposes extension tools and commands; remove resolves the same relative source", async () => {
  const { root, paths } = await fixture();
  const packageRoot = join(root, "fixture-package");
  await mkdir(join(packageRoot, "extensions"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "fixture-package", version: "1.0.0", pi: { extensions: ["extensions/example.js"] } }));
  await writeFile(join(packageRoot, "extensions", "example.js"), extension);
  await expect(managePlugin(paths, "add", "./fixture-package")).rejects.toThrow("--trust");
  await managePlugin(paths, "add", "./fixture-package", true);
  const runtime = await createTutorRuntime(paths, bridge);
  try {
    expect(runtime.session.getActiveToolNames()).toContain("fixture_tool");
    expect(runtime.session.getActiveToolNames()).not.toContain("bash");
    expect(runtime.session.getActiveToolNames()).not.toContain("read");
    const tool = runtime.session.agent.state.tools.find(tool => tool.name === "fixture_tool")!;
    expect((await tool.execute("fixture-call", {}, new AbortController().signal)).content).toEqual([{ type: "text", text: "works" }]);
    expect(runtime.services.resourceLoader.getExtensions().extensions.some(e => e.commands.has("fixture-command"))).toBe(true);
    expect(runtime.services.resourceLoader.getExtensions().errors).toEqual([]);
    const packagedPath = join(packageRoot, "extensions", "example.js");
    await manageResources(paths, "disable", "extensions", packagedPath);
    await runtime.session.reload();
    expect(runtime.session.getActiveToolNames()).not.toContain("fixture_tool");
    await manageResources(paths, "enable", "extensions", packagedPath, true);
    await runtime.session.reload();
    expect(runtime.session.getActiveToolNames()).toContain("fixture_tool");
    await expect(managePlugin(paths, "update", undefined)).rejects.toThrow("--trust");
    await managePlugin(paths, "update", undefined, true);
    const result = await managePlugin(paths, "remove", "./fixture-package") as { removed: boolean };
    expect(result.removed).toBe(true);
    await runtime.session.reload();
    expect(runtime.session.getActiveToolNames()).not.toContain("fixture_tool");
  } finally { await runtime.dispose(); }
  expect(await Bun.file(join(packageRoot, "extensions", "example.js")).exists()).toBe(true);
});

test("auto-discovered extension disable/enable and additional prompts use native Sato settings", async () => {
  const { root, paths } = await fixture();
  const path = join(paths.userResources.extensions, "fixture.js");
  await writeFile(path, extension);
  await manageResources(paths, "disable", "extensions", path);
  let runtime = await createTutorRuntime(paths, bridge);
  expect(runtime.session.getActiveToolNames()).not.toContain("fixture_tool");
  await runtime.dispose();
  await expect(manageResources(paths, "enable", "extensions", path)).rejects.toThrow("--trust");
  await manageResources(paths, "enable", "extensions", path, true);
  const prompt = join(root, "custom.md"); await writeFile(prompt, "My custom prompt");
  await manageResources(paths, "add", "prompts", "custom.md");
  runtime = await createTutorRuntime(paths, bridge);
  try {
    expect(runtime.session.getActiveToolNames()).toContain("fixture_tool");
    expect(runtime.services.resourceLoader.getPrompts().prompts.map(p => p.name)).toContain("custom");
    await manageResources(paths, "remove", "prompts", "custom.md");
    await runtime.session.reload();
    expect(runtime.services.resourceLoader.getPrompts().prompts.map(p => p.name)).not.toContain("custom");
  } finally { await runtime.dispose(); }
});

test("native theme selection persists only in the Sato agent root", async () => {
  const { paths } = await fixture();
  const theme = JSON.parse(await readFile(join(installedApplicationRoot, "node_modules", PI_PACKAGE, "dist", "modes", "interactive", "theme", "dark.json"), "utf8"));
  theme.name = "fixture-theme";
  await writeFile(join(paths.userResources.themes, "fixture-theme.json"), JSON.stringify(theme));
  const result = await manageTheme(paths, "set", "fixture-theme");
  expect(result.themes).toContain("fixture-theme");
  expect(result.selected).toBe("fixture-theme");
  const sdk = await loadPi(paths);
  expect(createSatoSettings(paths, sdk).getThemeSetting()).toBe("fixture-theme");
  await expect(manageTheme(paths, "set", "missing")).rejects.toThrow("Unknown theme");
});

test("package resource switches never widen an empty or narrowly selected native filter", async () => {
  const { root, paths } = await fixture();
  const packageRoot = join(root, "narrow-package");
  await mkdir(join(packageRoot, "extensions"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "narrow-package", version: "1.0.0" }));
  const first = join(packageRoot, "extensions", "first.js");
  await writeFile(first, extension);
  await writeFile(join(packageRoot, "extensions", "second.js"), extension.replaceAll("fixture_tool", "other_tool").replaceAll("fixture-command", "other-command"));
  const sdk = await loadPi(paths), settings = createSatoSettings(paths, sdk);
  settings.setPackages([{ source: packageRoot, extensions: [], prompts: [] }]); await settings.flush();
  await manageResources(paths, "disable", "extensions", first);
  let runtime = await createTutorRuntime(paths, bridge);
  expect(runtime.session.getActiveToolNames()).not.toContain("fixture_tool");
  expect(runtime.session.getActiveToolNames()).not.toContain("other_tool");
  await runtime.dispose();
  await manageResources(paths, "enable", "extensions", first, true);
  runtime = await createTutorRuntime(paths, bridge);
  try {
    expect(runtime.session.getActiveToolNames()).toContain("fixture_tool");
    expect(runtime.session.getActiveToolNames()).not.toContain("other_tool");
    await manageResources(paths, "disable", "extensions", first);
    await runtime.session.reload();
    expect(runtime.session.getActiveToolNames()).not.toContain("fixture_tool");
    expect(runtime.session.getActiveToolNames()).not.toContain("other_tool");
    await manageResources(paths, "enable", "extensions", first, true);
    await runtime.session.reload();
    expect(runtime.session.getActiveToolNames()).toContain("fixture_tool");
    expect(runtime.session.getActiveToolNames()).not.toContain("other_tool");
    const pkg = runtime.services.settingsManager.getPackages()[0];
    expect(typeof pkg === "object" && pkg.prompts).toEqual([]);
  } finally { await runtime.dispose(); }
});

test("ambient .agents skills stay excluded while a literal explicit opt-in remains possible", async () => {
  const { paths } = await fixture();
  const sdk = await loadPi(paths), settings = createSatoSettings(paths, sdk);
  const ambient = join(process.env.HOME || (await import("node:os")).homedir(), ".agents", "skills", "test-explicit", "SKILL.md");
  const skill = { name: "test-explicit", description: "Fixture", filePath: ambient, baseDir: ambient, disableModelInvocation: false, sourceInfo: { path: ambient, source: "auto", scope: "user" as const, origin: "top-level" as const } };
  const filter = createSatoResourceOptions(paths, settings).skillsOverride!;
  expect(filter({ skills: [skill], diagnostics: [] }).skills).toEqual([]);
  settings.setSkillPaths([ambient]);
  expect(filter({ skills: [skill], diagnostics: [] }).skills).toEqual([skill]);
  await settings.flush();
});

test("global npm fallback is never used; configured npm packages are provisioned in the Sato home", async () => {
  const { paths } = await fixture();
  const sdk = await loadPi(paths), settings = createSatoSettings(paths, sdk);
  settings.setPackages(["npm:@test/fixture@1.0.0"]);
  const installs: string[] = [];
  class Manager {
    async install(source: string) { installs.push(source); await mkdir(join(paths.agent, "npm", "node_modules", "@test", "fixture"), { recursive: true }); }
  }
  await ensureManagedPackages(paths, { ...sdk, DefaultPackageManager: Manager } as unknown as PiSdk, settings);
  expect(installs).toEqual(["npm:@test/fixture@1.0.0"]);
  await ensureManagedPackages(paths, { ...sdk, DefaultPackageManager: Manager } as unknown as PiSdk, settings);
  expect(installs).toHaveLength(1);
  await settings.flush();
});

test("reload reads newly edited package declarations before preventing global npm fallback", async () => {
  const { paths } = await fixture();
  const sdk = await loadPi(paths), settings = createSatoSettings(paths, sdk);
  await settings.flush();
  await writeFile(join(paths.agent, "settings.json"), JSON.stringify({ packages: ["npm:reload-fixture@1.0.0"] }));
  const installs: string[] = [];
  class Manager { async install(source: string) { installs.push(source); await mkdir(join(paths.agent, "npm", "node_modules", "reload-fixture"), { recursive: true }); } }
  let reloaded = false;
  const loader = { reload: async () => { expect(installs).toEqual(["npm:reload-fixture@1.0.0"]); reloaded = true; } } as unknown as ResourceLoader;
  guardSatoResourceLoader(loader, paths, { ...sdk, DefaultPackageManager: Manager } as unknown as PiSdk, settings);
  await loader.reload();
  expect(reloaded).toBe(true);
});

// Reuse the installed SDK via a junction: offline tests exercise the real public
// adapter without downloading the same package for each transaction test.
async function installedFixture(directory: string) {
  await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await symlink(join(installedApplicationRoot, "node_modules"), join(directory, "node_modules"), "junction");
}

test("isolated Pi update, rollback and reset retain data/settings; failed installation cannot activate", async () => {
  const { paths } = await fixture();
  const brain = await readFile(paths.brain, "utf8");
  await writeFile(join(paths.agent, "auth.json"), "{\"fixture\":\"do not touch\"}");
  expect((await piInfo(paths)).source).toBe("bundled");
  const first = await updatePi(paths, "1.0.0", { install: installedFixture });
  expect(first.source).toBe("isolated");
  expect((await loadPi(paths)).VERSION).toBe("1.0.0");
  const initial = await readPiSelection(paths);
  await expect(updatePi(paths, "1.0.0", { install: async () => { throw new Error("fixture install failure"); } })).rejects.toThrow("fixture install failure");
  expect(await readPiSelection(paths)).toEqual(initial);
  await expect(updatePi(paths, "1.0.0", { install: async directory => {
    const pkg = join(directory, "node_modules", PI_PACKAGE); await mkdir(pkg, { recursive: true });
    await writeFile(join(directory, "package.json"), "{}");
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: PI_PACKAGE, version: "1.0.0", type: "module", exports: { ".": { import: "./index.js" } } }));
    await writeFile(join(pkg, "index.js"), 'export const VERSION = "1.0.0";');
  } })).rejects.toThrow("createAgentSession");
  expect(await readPiSelection(paths)).toEqual(initial);
  await updatePi(paths, "1.0.0", { install: installedFixture });
  expect((await readPiSelection(paths))?.previous?.install).toBe(initial?.install);
  await rollbackPi(paths);
  expect((await readPiSelection(paths))?.install).toBe(initial?.install);
  await resetPi(paths);
  expect((await piInfo(paths)).source).toBe("bundled");
  expect(await readFile(paths.brain, "utf8")).toBe(brain);
  expect(await readFile(join(paths.agent, "auth.json"), "utf8")).toContain("do not touch");
  expect(await Bun.file(join(piRuntimeRoot(paths), initial!.install, "package.json")).exists()).toBe(true);
});

test("compatibility failure, missing local install, traversal and concurrent update are rejected", async () => {
  const { paths } = await fixture();
  await expect(updatePi(paths, "2.0.0", { install: installedFixture })).rejects.toThrow("Breaking major");
  await expect(updatePi(paths, "1.0.0", { install: async directory => { await writeFile(join(directory, "package.json"), "{}"); } })).rejects.toThrow();
  expect(await readPiSelection(paths)).toBeUndefined();
  const sdk = await loadPi(paths);
  expect(() => validatePiSdk({ ...sdk, VERSION: "2.0.0" })).toThrow("Unsupported Pi");
  expect(() => validatePiSdk({ ...sdk, InteractiveMode: undefined } as unknown as PiSdk)).toThrow("InteractiveMode");
  await writeFile(piSelectionPath(paths), JSON.stringify({ install: "../../global", version: "1.0.0" }));
  await expect(loadPi(paths)).rejects.toThrow("Invalid Pi runtime selection");
  await resetPi(paths);
  await writeFile(join(piRuntimeRoot(paths), "update.lock"), "fixture-running-process");
  await expect(updatePi(paths, "1.0.0", { install: installedFixture })).rejects.toThrow("Another Pi update");
});

test("CLI overrides a global Pi root, keeps native settings/resources separate and reports actual version", async () => {
  const { root, paths } = await fixture();
  const globalAgent = join(root, "global-pi"); await mkdir(globalAgent);
  const globalSettings = "{\"theme\":\"light\",\"packages\":[]}\n";
  await writeFile(join(globalAgent, "settings.json"), globalSettings);
  await mkdir(join(root, ".agents", "skills", "ambient"), { recursive: true });
  await writeFile(join(root, ".agents", "skills", "ambient", "SKILL.md"), "---\nname: ambient\ndescription: A global skill that must not leak\n---\nGlobal.");
  await mkdir(join(root, ".agents", "skills", "learning"), { recursive: true });
  await writeFile(join(root, ".agents", "skills", "learning", "SKILL.md"), "---\nname: learning\ndescription: An ambient collision that must not suppress Sato's skill\n---\nGlobal instructions.");
  const run = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, join(installedApplicationRoot, "apps", "cli", "src", "index.ts"), ...args], { cwd: root, env: { ...process.env, HOME: root, SATO_HOME: paths.home, PI_CODING_AGENT_DIR: globalAgent }, stdout: "pipe", stderr: "pipe" });
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(error).toBe(""); expect(code).toBe(0); return JSON.parse(output);
  };
  expect((await run("pi", "info")).version).toBe("1.0.0");
  expect((await run("theme", "set", "dark")).selected).toBe("dark");
  const resources = await run("resource", "list");
  expect(resources.skills.map((s: { name: string }) => s.name)).not.toContain("ambient");
  expect(resources.skills.find((s: { name: string }) => s.name === "learning").path).toContain(join("sato", "resources", "skills"));
  expect(resources.diagnostics).toEqual([]);
  expect(await readFile(join(globalAgent, "settings.json"), "utf8")).toBe(globalSettings);
  expect(await Bun.file(join(paths.data, "learning.sqlite")).exists()).toBe(false);
  const loader = await createSatoResourceLoader(paths); await loader.reload();
  expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
});
