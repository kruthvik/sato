import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { createSatoPaths } from "../src/paths.ts";

describe("Sato paths", () => {
  test("keeps package, user home and invocation directory distinct", () => {
    const paths = createSatoPaths({ applicationRoot: resolve("/app/sato"), userHome: resolve("/user"), cwd: resolve("/school/biology") });
    expect(paths.applicationRoot).toBe(resolve("/app/sato"));
    expect(paths.cwd).toBe(resolve("/school/biology"));
    expect(paths.home).toBe(resolve("/user/.learn"));
    expect(paths.agent).toBe(join(paths.home, "agent"));
    expect(paths.sessions).toBe(join(paths.home, "sessions"));
    expect(paths.brain).toBe(join(paths.home, "brain.md"));
    expect(paths.builtIn.skills).toBe(join(paths.applicationRoot, "resources", "skills"));
    expect(paths.userResources.skills).toBe(join(paths.agent, "skills"));
    expect(JSON.stringify(paths)).not.toContain(".pi");
  });
});
