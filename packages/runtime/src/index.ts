import { createSatoResourceLoader } from "../../pi/src/runtime.ts";
import { bootstrapSatoHome } from "./bootstrap.ts";
import type { SatoPaths } from "./paths.ts";

export { createSatoPaths } from "./paths.ts";
export { createSatoRuntime } from "./runtime.ts";

export async function inspectSatoResources(paths: SatoPaths) {
  await bootstrapSatoHome(paths);
  const loader = await createSatoResourceLoader(paths);
  await loader.reload();
  return {
    extensions: loader.getExtensions().extensions.length,
    skills: loader.getSkills().skills.length,
    prompts: loader.getPrompts().prompts.length,
    themes: loader.getThemes().themes.length,
    errors: loader.getExtensions().errors,
    diagnostics: [...loader.getSkills().diagnostics, ...loader.getPrompts().diagnostics, ...loader.getThemes().diagnostics],
  };
}
