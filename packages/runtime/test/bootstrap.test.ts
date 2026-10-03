import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapSatoHome } from "../src/bootstrap.ts";
import { createSatoPaths } from "../src/paths.ts";

const tempHomes: string[] = [];
afterEach(async () => { for (const home of tempHomes.splice(0)) await rm(home, { recursive: true, force: true }); });

test("creates only user-owned bootstrap files and resource roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "sato-bootstrap-"));
  tempHomes.push(root);
  const paths = createSatoPaths({ home: join(root, ".learn") });
  await bootstrapSatoHome(paths);
  expect((await readdir(paths.home)).sort()).toEqual(["agent", "brain.md", "sessions"]);
  expect((await readdir(paths.agent)).sort()).toEqual(["extensions", "prompts", "skills", "themes"]);
  expect(await readFile(paths.brain, "utf8")).toContain("Sato");
  await writeFile(paths.brain, "My own instructions\n");
  await bootstrapSatoHome(paths);
  expect(await readFile(paths.brain, "utf8")).toBe("My own instructions\n");
});
