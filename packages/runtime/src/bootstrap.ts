import { mkdir, writeFile } from "node:fs/promises";
import type { SatoPaths } from "./paths.ts";

export async function bootstrapSatoHome(paths: SatoPaths): Promise<void> {
  try {
    await mkdir(paths.sessions, { recursive: true });
    for (const root of Object.values(paths.userResources)) {
      await mkdir(root, { recursive: true });
    }
    await writeFile(paths.brain, "# Sato\n\nDescribe how you prefer to learn here. This file is yours to edit.\n", { flag: "wx" }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
  } catch (error) {
    throw new Error("Unable to initialize Sato home directory", { cause: error });
  }
}
