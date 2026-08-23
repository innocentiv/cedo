# cedo

Self-hosted workout tracker with a first-class MCP server, so an AI can plan and adjust your
training as a real user under real permissions.

Bun + Elysia + Postgres on the back, Expo (React Native for web, iOS and Android) on the front,
deployed with `docker compose`.

## Quick start

```bash
cp .env.example .env      # edit POSTGRES_PASSWORD
docker compose up --build -d
open http://localhost:8080
```

## Development

```bash
bun install
bun run db:up             # postgres only
bun run check             # format + lint + typecheck + tests — the gate
```

## Working on this codebase

Read **[CLAUDE.md](CLAUDE.md)** first, then **[docs/01-architecture.md](docs/01-architecture.md)**.
The `docs/` directory is the specification; `docs/playbooks/` has step-by-step recipes for adding
anything.

## Status

Under construction. See the milestone list in the project plan.
