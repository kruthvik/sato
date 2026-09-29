# Sato

Sato is a local AI-assisted learning workspace. It combines guided learning modes,
practice activities, a learner-controlled content library, and progress tools that
favor demonstrated understanding over familiarity.

The full project must be kept together: the `.pi/` configuration, `scripts/`,
`package.json`, launchers, `content/`, and `_learning/` work as one workspace.

## Requirements

- Windows 10/11
- [Bun](https://bun.sh/) on `PATH`
- [Pi](https://github.com/earendil-works/pi) on `PATH`
- A Pi provider configured in the workspace profile (the first launch guides setup)

## Install and run

1. Clone this repository and open a terminal in its root directory.
2. Install project dependencies and initialize the workspace:

   ```powershell
   bun install
   bun run setup
   ```

3. Start the learning assistant:

   ```powershell
   .\learn.cmd
   ```

   The first launch provisions required Pi extensions into the local
   `.learn-runtime/` profile. Authenticate a provider in that profile when prompted.
   The profile and credentials are local to your clone and are excluded from Git.

Use `./learn.cmd /help` for launcher commands, or `./learn.cmd /doctor` to check
the workspace setup. Use `bun run settings` to open the integrations/settings hub.

## Checks

```powershell
bun run check
bun run test
```

The YouTube integration test uses fixtures by default. `bun run test:youtube:live`
additionally checks caption availability against a public video and requires network
access.

## Workspace data

- `brain.md` is a blank, optional template for your learning preferences.
- Put your notes, activities, and exports under `content/`.
- `_learning/` stores generated progress and review state.
- `.learn-runtime/` contains local settings, installed providers, and credentials;
  do not publish it.

See [`content/README.md`](content/README.md) for content organization and
[`NOTICE.md`](NOTICE.md) for upstream attribution and permission context.
