---
name: setup
description: Set up this repo for development with `bun run setup`, from a fresh clone to a passing `bun run check`. Use on a fresh clone, or when the dev environment is incomplete — no `.env`, databases down, agent skills missing.
---

1. From the repo root, run `bun run setup` in the foreground. It ends by running `bun run check`, so it takes minutes.
2. Done when it prints `✓ Set up.` Anything else ends on a `✗ <step> failed` line naming the step and what to look at: fix that cause, then run it again. It is safe to re-run; `.env` and the dev data are kept.

What the failures usually are:

- **Prerequisites** (Bun, git, Docker, a running daemon) are on the user's machine: name what is missing and let the user install or start it.
- **Ports 55432 and 55433** taken by another Postgres: `README.md`, "If something goes wrong".
- **Agent skills** clone `mattpocock/skills` from GitHub at the commit `skills-lock.json` pins: a network problem, or a lock edited by hand (`scripts/skills-lock.ts` says how to re-pin).
- **`bun run check` red on a fresh setup** is a bug in the repo: report the failing output to the user as it is.
