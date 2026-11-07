# Security

## Reporting a vulnerability

Report it privately, through GitHub: **Security → Report a vulnerability** on this repository.
Please do not open an issue for it, or mention it anywhere public, until it is fixed.

Say what is affected, how to reproduce it, and what an attacker gains. A report reaches one
maintainer, who answers as soon as they can: there is no team and no promised response time.

## What is in scope

- The API server (`apps/api`), including its MCP server, reached at `/api/mcp`.
- The app (`apps/app`), as the web app and as it installs to a phone.
- The deployment this repository ships: `docker-compose.yml`, the Caddy configuration and the
  scripts in `scripts/`.

Out of scope: someone else's deployment of cedo, and the services it runs beside.

## What is supported

Only `main`. There are no releases yet, so a fix lands on `main` and a self-hosted instance takes it
by upgrading (`docs/09-deployment.md`).

## Before exposing an instance to the internet

The one list of what to know first; the README points here.

- Serve it over HTTPS, behind a reverse proxy (`docs/09-deployment.md`).
- Sign-up closes behind the instance's first account, which curates it. Open it only while the
  people you expect are registering (ADR-0029).
- Logins have no rate limit yet (#72): use long passwords, or limit `/api/auth/*` at the proxy.
- There is no way yet to change or recover a password (#69).
