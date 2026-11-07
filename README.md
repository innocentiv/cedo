# cedo

Self-hosted workout tracker with a first-class MCP server, so an AI can plan and adjust your
training as a real user under real permissions.

Bun + Elysia + Postgres on the back, Expo (React Native) on the front, deployed with
`docker compose`. The app ships as a web app that installs to a phone's home screen; native iOS and
Android builds are not configured yet (#10).

---

## Run it (no development)

```bash
cp .env.example .env      # set POSTGRES_PASSWORD to anything but the default
docker compose up --build -d
open http://localhost:8080
```

That is the whole install. Migrations and the starter exercise library run inside the API container
before it accepts traffic, and both are idempotent, so upgrading is a pull and a rebuild — on fresh
base images, so Bun and Caddy security patches arrive too:

```bash
git pull && docker compose pull db && docker compose build --pull && docker compose up -d
```

Details and backup instructions: **[docs/09-deployment.md](docs/09-deployment.md)**.

### Install it on your phone

Served over HTTPS (behind your NAS's reverse proxy, Tailscale Serve, or a tunnel), the app installs
like a native one, and opens even without a signal:

- **iPhone / iPad:** in Safari, **Share** (on iOS 26, behind the **⋯** button) **→ Add to Home
  Screen**.
- **Android:** in Chrome, **Install** when offered, or **⋮ → Add to Home screen → Install**.

Over plain `http://` on your network it still works in the browser, but it can't keep itself for
offline use. Details are in [docs/09-deployment.md](docs/09-deployment.md#installing-the-app).

---

## Develop

### What you need first

| | Why | Check |
| --- | --- | --- |
| **[Bun](https://bun.sh) 1.4+** | runtime, package manager, test runner, bundler | `bun --version` |
| **Docker** with compose v2 | Postgres, nothing else | `docker compose version` |
| **git** | cloning, and fetching the agent skills | `git --version` |

Nothing else — no global Node, no `npm i -g`, no database installed on your machine.

### Set it up

```bash
git clone <this repo> && cd cedo
bun run setup
```

`setup` checks for Bun, git and Docker, installs dependencies, creates `.env` from the template,
starts both Postgres containers, migrates and seeds. It then installs the agent skills that
`skills-lock.json` pins, for Claude Code and Codex, and ends by running `bun run check`. It is safe
to re-run: it never overwrites an existing `.env` or wipes a database.

Then:

```bash
bun run dev      # API on :3000 and the web app on :8081, in one terminal
```

Open **http://localhost:8081** and register an account. You will land on Today with a library of
47 exercises already there.

Prefer separate terminals? `bun run dev:api` and `bun run dev:app`.

### Do you need to edit `.env`?

**No.** The defaults in `.env.example` are development values and work as they are. It is copied for
you, and `apps/api/src/env.ts` validates every variable at boot — a typo is a readable message, not
a crash later.

Three you might touch:

| Variable | When |
| --- | --- |
| `CEDO_CURATOR_USERNAME` | Rarely. A fresh instance's first account already curates the **shared** exercise library, and sign-up closes behind it. Only for an instance set up before that: register the account first, then set this and restart. |
| `PORT` | The API port, if 3000 is taken. Also set `CEDO_DEV_API_ORIGIN=http://127.0.0.1:<port>` in the shell running `bun run dev`, or the web app's dev proxy keeps calling :3000 and every request fails. |
| `POSTGRES_PORT` | The database port, if 55432 is taken. Change `DATABASE_URL` to match. |

One thing worth knowing, because it looks like a mistake: `.env` has `DATABASE_URL` pointing at
`localhost`, while `docker compose` talks to a host called `db`. Both are right. Compose composes
its own URL for the containers; the one in `.env` is for the API **you** run with `bun run dev`, and
`db` does not resolve outside the compose network.

### The two databases

`bun run db:up` starts both, and you want both:

| | Port | Used by |
| --- | --- | --- |
| `cedo` | 55432 | `bun run dev` — your data, survives restarts |
| `cedo_test` | 55433 | `bun run check` — **truncated between every test** |

They are separate on purpose. When `NODE_ENV=test` (which every `bun test` from the root sets)
`DATABASE_URL` is ignored entirely and `TEST_DATABASE_URL` is used, so a stray test run cannot reach
your development data. Started anywhere else, the tests refuse to run without `NODE_ENV=test`.

### The commands you will actually use

```bash
bun run check          # format, lint, typecheck, doc links, every test — the gate
bun run test:changed   # inner loop: only tests touched by your diff
bun run shot /today    # render a UI route, screenshot to .artifacts/, print console errors
```

`bun run check` must pass before every commit. It needs the test database, which `setup` and
`db:up` both start.

<details>
<summary>Everything else</summary>

| Command | Does |
| --- | --- |
| `bun run dev:api` / `dev:app` | one half of `dev` |
| `bun run db:up` / `db:down` | start / stop both databases |
| `bun run db:migrate` / `db:seed` | apply migrations / seed the library |
| `bun run db:reset` | wipe the dev database and rebuild it from scratch |
| `bun run db:studio` | browse the database in Drizzle Studio |
| `bun run e2e` | full UI journeys against a real API. **Foreground only** |
| `bun run perf` | N+1 and index guards against a 250k-row database |
| `bun run perf:report` | writes `.artifacts/perf.md` — every hot path's plans |

</details>

### If something goes wrong

| Symptom | Cause |
| --- | --- |
| `No Postgres is listening on localhost:55433` | `bun run db:up` |
| `port 55433 is already allocated` on `db:up` | a test database from before the test stack had its own project name: `docker rm -f cedo-test-db-1`, once |
| `ENOTFOUND db` | `DATABASE_URL` in `.env` says `db`; for local dev it must say `localhost` |
| `bun run e2e` fails everything after minutes | it was backgrounded; the WebView needs the foreground |
| `0 files were searched` | a script's glob is wrong, not an empty suite |

---

## Working on this codebase

Read **[CLAUDE.md](CLAUDE.md)** first — it is short, and its seven invariants are load-bearing. Then
**[docs/01-architecture.md](docs/01-architecture.md)**.

`docs/` is the specification, not notes: every layer has a file, every significant decision has an
ADR in `docs/adr/`, and `docs/playbooks/` has step-by-step recipes. To add an entity end to end,
follow **[docs/playbooks/add-entity.md](docs/playbooks/add-entity.md)** exactly.

The three rules worth knowing before you type anything:

1. **`packages/contract` is the only shared surface.** `apps/app` must never import from `apps/api`,
   not even a type. Enforced by lint.
2. **Business logic lives in `service.ts`.** Route handlers and MCP tools are ≤5 lines and both call
   the same function.
3. **Owned tables are read only through their visible relations** (`db/visible.ts`) — joins
   included — and written only in a module's `write*.ts`, with `editable()`. Lint enforces it.

## Status

Before 1.0, maintained by one person, and in daily use on the maintainer's own instance. There are
no releases or version numbers yet: `main` is what runs, and an instance upgrades by pulling it.
Versioned releases are planned with the native app (#10).

All milestones complete: contract, database, API, exercises and media, workouts and logs, MCP,
performance, frontend, and deployment. The app is web only: there is no native build configuration
(no `eas.json`, no bundle ids). On the web it calls `/api` on its own origin; a native build would
need the server address fixed when it is built, one build per instance. A native app with the
address entered at runtime is issue #10. The web app installs to a home screen and opens without a
signal (see above).

## Exposing it to the internet

Serve it over HTTPS ([docs/09-deployment.md](docs/09-deployment.md)). Its first account curates it,
and sign-up closes behind that account: open it from Settings only while the people you expect
register. Before you do, read "Before exposing an instance to the internet" in
[SECURITY.md](SECURITY.md): what is not protected yet, and what to do about it.

## Security

Report a vulnerability privately: see [SECURITY.md](SECURITY.md).

## Contributing

Only collaborators open issues and pull requests for now: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[AGPL-3.0-or-later](LICENSE). Run it, change it and share it; if you run a changed version for
others, over a network, offer them its source.
