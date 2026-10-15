# Overview

## What cedo is

A workout tracker for people who plan their training deliberately and want to log progression
accurately. It is self-hosted: one `docker compose up` on a NAS or a small server, no cloud account,
no subscription, no telemetry.

It is intended to be **distributed free to a large number of people**, each running their own
instance on modest hardware. That constraint is why performance guards are part of the build rather
than an afterthought — see `docs/10-testing.md`.

## The core loop

1. **Exercises** describe a movement: what it is, how to perform it, media showing it, and which
   muscles it loads and by how much.
2. **Workouts** arrange exercises into days. Within a day, entries run in order; entries sharing a
   superset group are performed alternating. Each entry prescribes sets with target reps and weight,
   and optionally a progression rule.
3. **Sessions** are executions. You start a session from a workout day (or from nothing, ad hoc) and
   log what you actually lifted, set by set.
4. **Progression** compares prescribed against actual and proposes the next targets.

## Sharing

Everything you create belongs to a **group**. Every user gets a personal group automatically, so
"mine" and "shared" are the same mechanism with no special cases. Groups have editors and readers.
A seeded `cedo` group carries the starter exercise library that every user can read.

You can favourite anything visible to you, duplicate anything into a group you can edit, and
transfer ownership between groups you can edit.

## AI as a first-class operator

An MCP server is part of the API, not a bolt-on. An AI with a personal access token can do
everything the UI can — create exercises, build workouts, log sessions, evaluate progression — as a
real user, under exactly the same permissions. The expectation is that most users will have their
training programmed and adjusted by an AI rather than by hand.

## Explicit non-goals (for now)

These are deliberately **not** built. The architecture leaves room for them, but do not implement
them without being asked:

- **Progress graphs.** The data and indexes exist (`GET /exercises/:id/history`); the charts do not.
- **Meal planning** — recipes, ingredients, shopping lists, meal prep. Will reuse the ownable/
  sharing machinery unchanged; see `docs/playbooks/add-entity.md`.
- **Imperial units.** Everything is stored metric. Conversion is isolated to one file so display-
  level imperial support is additive.
- **IAM / SSO.** Auth is username and password. The `users.auth_provider` / `users.external_id`
  columns (and the unique index on the latter) exist so OIDC can be added without a schema redesign.
  There is no `AuthProvider` interface in code yet; it is the shape the first OIDC change will add.
- **CDN, cache layer, horizontal scaling.** One database, one API process, one static file server.
