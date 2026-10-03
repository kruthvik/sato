import { access } from "node:fs/promises";
import type { DisposableRuntime } from "../../core/src/index.ts";
import { createSatoPiRuntime } from "../../pi/src/runtime.ts";
import { bootstrapSatoHome } from "./bootstrap.ts";
import type { SatoPaths } from "./paths.ts";

export interface RuntimeOptions {
  createPi?: (paths: SatoPaths) => Promise<DisposableRuntime>;
}

export function createSatoRuntime(paths: SatoPaths, options: RuntimeOptions = {}) {
  let pi: DisposableRuntime | undefined;
  let closed = false;
  return {
    async start(): Promise<void> {
      if (closed || pi) throw new Error("Sato runtime has already started or stopped");
      for (const root of Object.values(paths.builtIn)) {
        try { await access(root); } catch (error) { throw new Error(`Required application resource missing: ${root}`, { cause: error }); }
      }
      await bootstrapSatoHome(paths);
      pi = await (options.createPi ?? createSatoPiRuntime)(paths);
    },
    async dispose(): Promise<void> {
      if (closed) return;
      closed = true;
      await pi?.dispose();
      pi = undefined;
    },
  };
}
