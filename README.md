# Sato

Sato is a learning engine built on top of [pi-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), utilizing mainstream learning research.

> **Note:** This is my personal implementation. The current setup may not work best for everyone, so use your own judgment and discretion when adapting it.

## Current Implementation

The current version uses extension and skill injection into existing pi-agent downloads to separate global and local instances. Back up pi-agent and the current setup in case of failure, and verify the integration before relying on it.

Sato also includes various integrations and add-ons, with more likely to come in the future.

To run it, run `.\learn.ps1` or `.\learn.cmd`. I don't have much bash experience so I unfortunately didn't include a bash script for Linux and macOS users, but it shouldn't be too different from what I have already implemented.

## Development Notes

A large portion of this application features AI-generated and AI-assisted code. While the core system design and setup were personally created, much of the internal structure and the extensions and skills were not.

While making this, I ran multiple feynman agent runs and combined research and added features that might cause unnecessary overhead. This is why I am personally redesigning the project from scratch and making it similar to how feynman operates, increasing the ease of downloading it, the effectiveness of using it, and the compatibility of its custom integrations. I will update this repo when that is finished.


## Credits
The idea and inspiration for the overall system comes from https://www.youtube.com/watch?v=kzcI5F4tGiU&list=WL&index=10 and his other videos. While this program greatly expands on his work, it also takes great influence from his content. 

Of course, this project relies heavily on the pi project and is directly built on it and other extensions by related authors, so credits to them as well. 

The research notes should also still be present in the program with apt citations. If any other issues with credit are present, please let me know and I will address them.


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
