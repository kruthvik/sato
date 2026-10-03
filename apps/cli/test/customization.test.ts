import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCustomization, executeCustomization, formatCustomization } from "../src/customization.ts";
import { createSatoPaths } from "../../../packages/runtime/src/paths.ts";
import { createTutorRuntime, type TutorBridge } from "../../../packages/pi/src/tutor.ts";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("Pi-style commands distinguish engine and package updates and reject ambiguous/global flags", () => {
  expect(parseCustomization("install", ["npm:reviewed-tools", "--trust"])).toEqual({ kind: "package", action: "add", source: "npm:reviewed-tools", trusted: true, json: false });
  expect(parseCustomization("uninstall", ["./tools", "--json"])).toMatchObject({ kind: "package", action: "remove", source: "./tools", json: true });
  expect(parseCustomization("update", [])).toEqual({ kind: "engine", json: false });
  expect(parseCustomization("update", ["--extensions", "--trust"])).toMatchObject({ kind: "package", action: "update", source: undefined, trusted: true });
  expect(parseCustomization("update", ["npm:reviewed-tools", "--trust"])).toMatchObject({ kind: "package", action: "update", source: "npm:reviewed-tools" });
  expect(parseCustomization("extensions", [])).toMatchObject({ kind: "extensions", action: "list" });
  expect(parseCustomization("extensions", ["enable", "./tools.ts", "--trust"])).toMatchObject({ kind: "extensions", action: "enable", path: "./tools.ts", trusted: true });
  expect(parseCustomization("config", [])).toEqual({ kind: "config", json: false });
  expect(parseCustomization("status", [])).toBeUndefined();
  for (const [command, args] of [
    ["install", []], ["install", ["x", "y"]], ["install", ["x", "--local"]], ["remove", ["x", "--global"]],
    ["update", ["x", "--extensions"]], ["update", ["--all"]], ["update", ["--trust"]],
    ["extensions", ["disable"]], ["extensions", ["list", "x"]], ["extensions", ["enable", "x", "--trust", "--trust"]],
  ] as Array<[string, string[]]>) expect(() => parseCustomization(command, args)).toThrow();
});

test("new commands delegate to existing isolated Pi adapters, not a new package manager", async () => {
  const calls: unknown[][] = [];
  const paths = createSatoPaths({ home: join(tmpdir(), "sato-unused-command-test") });
  const operations = {
    bootstrap: async () => { calls.push(["bootstrap"]); },
    plugin: async (...args: unknown[]) => { calls.push(["plugin", ...args]); return []; },
    resources: async (...args: unknown[]) => { calls.push(["resources", ...args]); return {}; },
    update: async (...args: unknown[]) => { calls.push(["engine", ...args]); return { version: "1.0.0" }; },
  };
  await executeCustomization(paths, parseCustomization("update", [])!, operations);
  expect(calls).toEqual([["engine", paths]]);
  calls.length = 0;
  await executeCustomization(paths, parseCustomization("update", ["--extensions", "--trust"])!, operations);
  expect(calls).toEqual([["bootstrap"], ["plugin", paths, "update", undefined, true]]);
  calls.length = 0;
  await executeCustomization(paths, parseCustomization("extensions", ["disable", "./tools.ts"])!, operations);
  expect(calls).toEqual([["bootstrap"], ["resources", paths, "disable", "extensions", "./tools.ts", false]]);
  expect(formatCustomization(parseCustomization("update", [])!, { version: "1.0.0" })).toContain("1.0.0");
  expect(formatCustomization(parseCustomization("list", [])!, [])).toContain("No Pi packages");
  expect(JSON.parse(formatCustomization(parseCustomization("list", ["--json"])!, [{ source: "fixture" }]))).toEqual([{ source: "fixture" }]);
});

test("real CLI installs a single extension file, loads its tools, switches it off/on and removes it without touching global Pi", async () => {
  const root = await mkdtemp(join(tmpdir(), "sato-simple-cli-")); roots.push(root);
  const home = join(root, "home"), global = join(root, "global-pi"), filename = join(root, "helper.ts");
  const entry = resolve("apps/cli/src/index.ts");
  await writeFile(filename, `export default function(pi) {
    pi.registerTool({ name: "simple_cli_tool", label: "Simple", description: "Test extension", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "works" }] }) });
    pi.registerCommand("simple-cli-command", { description: "Test command", handler: async () => {} });
  }`);
  const invoke = async (...args: string[]) => {
    const child = Bun.spawn(["bun", entry, ...args], { cwd: root, env: { ...Bun.env, SATO_HOME: home, PI_CODING_AGENT_DIR: global }, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  };
  expect((await invoke("install", "./helper.ts")).stderr).toContain("--trust");
  expect((await invoke("list")).stdout).toContain("No Pi packages installed");
  const installed = await invoke("install", "./helper.ts", "--trust");
  expect(installed.code).toBe(0); expect(installed.stdout).toContain("Installed:");
  expect((await invoke("list")).stdout).toContain(filename);
  expect(JSON.parse((await invoke("list", "--json")).stdout)).toHaveLength(1);
  expect((await invoke("extensions")).stdout).toContain(filename);
  expect((await invoke("config")).stdout).toContain("skills:");
  const bridge: TutorBridge = { operation: async () => ({}), input: async () => {}, goal: async () => ({}), source: async () => [], approve: async () => ({}), calls: async () => { throw new Error("No paid calls"); }, stop: async () => ({}), shutdown: async () => {} };
  const runtime = await createTutorRuntime(createSatoPaths({ home, cwd: root }), bridge);
  try {
    expect(runtime.session.getActiveToolNames()).toContain("simple_cli_tool");
    expect(runtime.services.resourceLoader.getExtensions().extensions.some(extension => extension.commands.has("simple-cli-command"))).toBe(true);
    expect((await invoke("extensions", "disable", "./helper.ts")).code).toBe(0);
    await runtime.session.reload(); expect(runtime.session.getActiveToolNames()).not.toContain("simple_cli_tool");
    expect((await invoke("extensions", "enable", "./helper.ts", "--trust")).code).toBe(0);
    await runtime.session.reload(); expect(runtime.session.getActiveToolNames()).toContain("simple_cli_tool");
    expect((await invoke("uninstall", "./helper.ts")).code).toBe(0);
    await runtime.session.reload(); expect(runtime.session.getActiveToolNames()).not.toContain("simple_cli_tool");
    expect((await invoke("extensions", "add", "./helper.ts", "--trust")).code).toBe(0);
    await runtime.session.reload(); expect(runtime.session.getActiveToolNames()).toContain("simple_cli_tool");
    expect((await invoke("extensions", "disable", "./helper.ts")).code).toBe(0);
    await runtime.session.reload(); expect(runtime.session.getActiveToolNames()).not.toContain("simple_cli_tool");
    expect((await invoke("extensions", "enable", "./helper.ts", "--trust")).code).toBe(0);
    await runtime.session.reload(); expect(runtime.session.getActiveToolNames()).toContain("simple_cli_tool");
    expect((await invoke("remove", "./helper.ts")).code).toBe(0);
    await runtime.session.reload(); expect(runtime.session.getActiveToolNames()).not.toContain("simple_cli_tool");
  } finally { await runtime.dispose(); }
  expect(await readFile(filename, "utf8")).toContain("simple_cli_tool");
  expect(await Bun.file(join(global, "settings.json")).exists()).toBe(false);
  expect((await invoke("update", "--extensions")).stderr).toContain("--trust");
  expect((await invoke("update", "--extensions", "--trust")).code).toBe(0);
  expect((await invoke("install", "./helper.ts", "--global", "--trust")).code).toBe(1);
  expect((await invoke("--version")).stdout).toContain("Pi 1.");
  expect((await invoke("--help")).stdout).toContain("learn install");
  expect((await invoke("help", "--all")).stdout).toContain("learn resource");
});
