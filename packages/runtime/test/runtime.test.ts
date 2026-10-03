import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSatoRuntime } from "../src/runtime.ts";
import { createSatoPaths } from "../src/paths.ts";

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });

test("bootstraps, hands control to Pi once and disposes idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "sato-runtime-"));
  temporary.push(root);
  const paths = createSatoPaths({ home: join(root, ".learn") });
  let starts = 0;
  let disposals = 0;
  const runtime = createSatoRuntime(paths, {
    createPi: async (received) => {
      expect(received).toBe(paths);
      starts++;
      return { dispose: async () => { disposals++; } };
    },
  });
  await runtime.start();
  expect(starts).toBe(1);
  expect(await readdir(paths.home)).toContain("brain.md");
  await runtime.dispose();
  await runtime.dispose();
  expect(disposals).toBe(1);
});
