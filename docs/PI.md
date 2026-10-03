# Pi customization and updates

Sato embeds Pi's public SDK and native terminal. It does not fork Pi, invoke a globally installed executable, or copy global credentials. Pi is a normal dependency; the checked-in lockfile currently resolves 1.0.0. Sato supports Pi 1.x and checks the actual tutor adapter before activating a separately installed version.

## Update the engine independently

```sh
learn pi info
learn pi update              # Latest release, if compatible with Pi 1.x
learn pi update 1.0.0         # Explicit reproducible selection
learn pi rollback            # Previous checked isolated selection
learn pi reset               # Bundled dependency; installed copies remain
```

Updates go under `SATO_HOME/pi-runtime/install-UUID/`, never into a global npm/Bun installation. The candidate is installed with lifecycle scripts disabled, checked against required public exports, and started with the actual four-tool tutor adapter in an empty probe home without credentials or provider calls. Only a successful check publishes `active.json`, using an atomic rename. Failed candidates and older installs are retained for diagnosis and recovery. Unsupported major versions are rejected rather than silently assumed compatible.

Updates affect the next tutor launch. A running tutor keeps its current SDK. The first isolated update has no previous isolated installation: use reset to return to bundled Pi. Subsequent updates support rollback. A stale `update.lock` requires checking that its recorded PID has exited before removing that exact lock. Custom extensions may need their own compatibility fixes even when core startup passes.

For development, `bun update @earendil-works/pi-coding-agent` updates the bundled dependency within its declared range. Run lint, tests and smoke afterward. If an isolated SDK is selected, it takes precedence until reset or another isolated update.

## Native Pi packages

```sh
learn install npm:@example/pi-tools@1.0.0 --trust
learn install git:github.com/example/pi-tools@v1 --trust
learn install ./local-package --trust
learn install ./helper.ts --trust
learn list
learn remove ./local-package
learn update                          # Update Sato's isolated Pi SDK
learn update --extensions --trust      # Update all native Pi packages
learn update npm:@example/pi-tools --trust
```

These are the familiar [Pi command-line verbs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md), adapted to one isolated Sato scope and an explicit trust acknowledgement. `uninstall` aliases `remove`. `learn --version` reports the selected SDK. Customization commands accept `--json`; the existing `plugin` and `resource` commands remain compatible. `--local` and `--global` are rejected, not forwarded to a global Pi instance. `learn update` does not also update executable packages; that requires the explicit package command above.

Examples use placeholder package names; choose a real package you have reviewed. npm/git sources use Pi's native syntax, manifests, dependency installation and filters. Relative local sources are resolved from the invocation directory for both add and remove. Local packages are referenced, not copied or deleted. Managed npm/git package removal uses native Pi removal. Unversioned npm sources can track updates; pinned npm versions do not advance automatically. Add an explicit new version to change a pin. Git updates reconcile the configured ref, without moving a tag or commit to a different ref.

Packages can supply extensions, commands, skills, prompts and themes together. Installed extension tools work alongside the four learning tools. Built-in coding tools such as read/bash/edit/write are disabled in tutor sessions. Pi CLI-only built-in extensions are not automatically injected into this SDK host; reviewed packages can provide additional capabilities.

Sato ensures configured npm packages have managed copies in `agent/npm/node_modules/` before discovery or reload, rather than accepting Pi's legacy global npm fallback. Explicitly configured local paths can intentionally reference resources elsewhere. Isolation protects configuration ownership; it is not a filesystem or network sandbox. Third-party extension code and installation scripts have OS privileges and can access local files or send data externally. `--trust` acknowledges that boundary.

## Individual resources

```sh
learn extensions                      # Show loaded extension paths
learn extensions add ./helper.ts --trust
learn extensions disable ./helper.ts
learn extensions enable ./helper.ts --trust
learn extensions remove ./helper.ts
learn config                          # Readable resources and diagnostics
learn resource list
learn resource add extensions "C:/my-resources/helper.ts" --trust
learn resource add skills "C:/my-resources/study-skill"
learn resource add prompts "C:/my-resources/review.md"
learn resource add themes "C:/my-resources/custom.json"
learn resource disable extensions "C:/my-resources/helper.ts"
learn resource enable extensions "C:/my-resources/helper.ts" --trust
learn resource remove prompts "C:/my-resources/review.md"
```

Kinds are `extensions`, `skills`, `prompts` and `themes`. Use paths shown by resource list for individual packaged resources. Enable/disable writes Pi's own resource switches and package-specific filters, preserving other settings. Remove unregisters a top-level path without deleting its files. An auto-discovered resource can still load after unregistering its path: disable it to turn it off. Adding/enabling executable extensions requires `--trust`.

Pi's direct-file package loader does not honor package resource filters. Switching a directly installed file migrates that one registration to Pi's native standalone path/switch settings, without moving or deleting the file. It then appears through `learn extensions` when enabled rather than `learn list` (which lists packages). `learn remove PATH` also unregisters that standalone path. Explicit external resources retain a discovery path alongside their switch so disabling and re-enabling them actually works.

Standard auto-discovery directories live under `SATO_HOME/agent/`. Native resource edits take effect on the next launch or `/reload`. Sato's inline learning tools and packaged tutor policy are application infrastructure, not removable customization packages.

## Themes and other settings

```sh
learn theme list
learn theme set dark
learn theme set light
learn theme set system
learn theme set MY_INSTALLED_THEME
```

Custom themes can be installed through packages or resource paths. Selection is validated against successfully loaded themes and saved to Sato's native `agent/settings.json`. `/settings` changes the current terminal; CLI selection applies on the next launch. Native Pi theme syntax and validation remain authoritative.

Pi also owns `/login`, `/model`, `/settings`, `/reload`, session navigation and its other normal terminal controls. Advanced settings can be edited in `SATO_HOME/agent/settings.json` using Pi's documented schema, including filtered package objects. Keybindings belong in `agent/keybindings.json` and custom model/provider definitions in `agent/models.json`. The CLI overrides `PI_CODING_AGENT_DIR` only in its own process, so terminal helpers use the same isolated root as the SDK.

Global Pi settings, authentication, packages and themes remain untouched by Sato's own operations. Invocation `.pi` context/resources are not auto-loaded. Shared `~/.agents/skills` are excluded by default; a literal skill/package path explicitly registered in Sato settings opts into sharing. Provider environment variables are still honored by Pi.

The planning subagent is another short-lived session of the same selected Pi SDK, not a separate global Pi process or model service. It reuses the selected provider/auth runtime (including registered provider integrations) but loads none of the tutor's user extensions, tools, themes or ambient instructions. A child plan adds one model request at intake or consequential replanning; it does not run after every answer. Both tutor and planner benefit from Sato's isolated Pi updates.

`learn doctor` shows the selected version, paths, resource diagnostics and learning-store integrity without reading credentials into its output. Resource inspection can execute configured extensions and install missing configured packages through Pi; it is not a sandboxed or strictly offline check. Educational backups exclude Pi credentials, transcripts, settings, packages and runtime installations; back those up separately if needed.
