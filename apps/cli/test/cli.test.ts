import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

test("root package publishes a Bun executable and bundles Pi", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  expect(manifest.name).toBe("sato");
  expect(manifest.bin.learn).toBe("apps/cli/src/index.ts");
  expect(manifest.dependencies["@earendil-works/pi-coding-agent"]).toBeDefined();
  expect(manifest.files).toContain("docs/");
  expect((await readFile(resolve(root, manifest.bin.learn), "utf8")).startsWith("#!/usr/bin/env bun")).toBe(true);
});
