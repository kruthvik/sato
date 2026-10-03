import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ResourceRoots {
  extensions: string;
  skills: string;
  prompts: string;
  themes: string;
}

export interface SatoPaths {
  applicationRoot: string;
  cwd: string;
  home: string;
  agent: string;
  sessions: string;
  config: string;
  data: string;
  cache: string;
  brain: string;
  builtIn: ResourceRoots;
  userResources: ResourceRoots;
}

export interface PathOptions {
  applicationRoot?: string;
  userHome?: string;
  cwd?: string;
  home?: string;
}

// Resolve from the installed module, never the directory in which `learn` was invoked.
export const installedApplicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function resourceRoots(root: string): ResourceRoots {
  return {
    extensions: join(root, "extensions"),
    skills: join(root, "skills"),
    prompts: join(root, "prompts"),
    themes: join(root, "themes"),
  };
}

export function createSatoPaths(options: PathOptions = {}): SatoPaths {
  const applicationRoot = resolve(options.applicationRoot ?? installedApplicationRoot);
  const home = resolve(options.home ?? join(options.userHome ?? homedir(), ".learn"));
  const agent = join(home, "agent");
  return {
    applicationRoot,
    cwd: resolve(options.cwd ?? process.cwd()),
    home,
    agent,
    sessions: join(home, "sessions"),
    config: join(home, "config"),
    data: join(home, "data"),
    cache: join(home, "cache"),
    brain: join(home, "brain.md"),
    builtIn: resourceRoots(join(applicationRoot, "resources")),
    userResources: resourceRoots(agent),
  };
}
