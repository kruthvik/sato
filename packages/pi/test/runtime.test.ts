import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";
import { createSatoPaths } from "../../runtime/src/paths.ts";
import { createSatoPiRuntime, createSatoResourceLoader } from "../src/runtime.ts";

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });

test("discovers Sato user and built-in skills, not invocation .pi or global Pi", async () => {
  const root = await mkdtemp(join(tmpdir(), "sato-pi-"));
  temporary.push(root);
  const paths = createSatoPaths({ applicationRoot: join(root, "app"), userHome: root, cwd: join(root, "invocation") });
  for (const location of [paths.builtIn.skills, paths.userResources.skills, join(paths.cwd, ".pi", "skills"), join(root, ".pi", "agent", "skills")]) {
    const name = location === paths.builtIn.skills ? "built-in" : location === paths.userResources.skills ? "user" : "leak";
    await mkdir(join(location, name), { recursive: true });
    await writeFile(join(location, name, "SKILL.md"), `---\nname: ${name}\ndescription: A test skill\n---\nUse this skill.\n`);
  }
  await mkdir(paths.userResources.prompts, { recursive: true });
  await writeFile(join(paths.userResources.prompts, "review.md"), "A user prompt template.\n");
  await mkdir(join(paths.cwd, ".pi", "prompts"), { recursive: true });
  await writeFile(join(paths.cwd, ".pi", "prompts", "leak.md"), "An invocation prompt.\n");
  const loader = await createSatoResourceLoader(paths);
  await loader.reload();
  expect(loader.getSkills().skills.map((skill) => skill.name).sort()).toEqual(["built-in", "user"]);
  expect(loader.getPrompts().prompts.map((prompt) => prompt.name)).toEqual(["review"]);
});

test("uses normal Pi packages declared only in Sato settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "sato-package-"));
  temporary.push(root);
  const paths = createSatoPaths({ home: join(root, ".learn"), cwd: join(root, "school") });
  const packageRoot = join(root, "sample-pi-package");
  await mkdir(join(packageRoot, "skills", "packaged"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "sample-pi-package", version: "1.0.0" }));
  await writeFile(join(packageRoot, "skills", "packaged", "SKILL.md"), "---\nname: packaged\ndescription: A packaged test skill\n---\nPackaged resource.\n");
  await mkdir(paths.agent, { recursive: true });
  await writeFile(join(paths.agent, "settings.json"), JSON.stringify({ packages: [packageRoot] }));
  const loader = await createSatoResourceLoader(paths);
  await loader.reload();
  expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("packaged");
});

test("passes isolated settings, resources and sessions to Pi, then disposes", async () => {
  const root = await mkdtemp(join(tmpdir(), "sato-pi-"));
  temporary.push(root);
  const paths = createSatoPaths({ home: join(root, ".learn"), cwd: join(root, "school") });
  await mkdir(paths.agent, { recursive: true });
  let disposed = false;
  const runtime = await createSatoPiRuntime(paths, {
    createSession: async (options) => {
      expect(options?.cwd).toBe(paths.cwd);
      expect(options?.agentDir).toBe(paths.agent);
      expect(options?.settingsManager).toBeDefined();
      expect(options?.resourceLoader).toBeDefined();
      expect(options?.sessionManager).toBeDefined();
      return { session: { dispose: () => { disposed = true; } } } as CreateAgentSessionResult;
    },
  });
  await runtime.dispose();
  expect(disposed).toBe(true);
});
