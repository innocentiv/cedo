---
name: setup
description: Set up this repo for development with `bun run setup`. Use on a fresh clone, or when the dev environment is incomplete — no `.env`, databases down, agent skills missing.
---

1. From the repo root, run `bun run setup` in the foreground. It ends by running `bun run check`, so it takes minutes.
2. Done when it prints `✓ Set up.` Otherwise its last line starts with `✗` and says what failed and what to look at: fix that cause, then run it again. It is safe to re-run; `.env` and the dev data are kept.

A missing prerequisite (Bun, git, Docker, a running daemon) is on the user's machine: name it and let the user install or start it. A red `bun run check` at the end of a fresh setup is a bug in the repo: report its output to the user as it is.
