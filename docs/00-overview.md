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
   superset group are performed alternating. Each entry prescribes its sets — reps, weight and reps
   in reserve — and either a progression rule, or none (manual: nothing moves the plan's numbers but
   an edit to the plan).
3. **Sessions** are executions. You start a session from a workout day (or from nothing, ad hoc) and
   log what you actually lifted, set by set.
4. **Progression** judges each finished session against your target and moves it — or holds it, and
   says why. The plan's prescription is where your target starts; your target is where you are.

## Sharing

Everything you create belongs to a **group**. Every user gets a personal group automatically, so
"mine" and "shared" are the same mechanism with no special cases. Groups have editors and readers.
A seeded `cedo` group carries the starter exercise library that every user can read.

You can favourite anything visible to you, duplicate anything into a group you can edit, and
transfer ownership between groups you can edit. Editors add and remove a group's members; any
member may leave, except its last editor. Nobody leaves the starter library: every account reads
it, so every shared plan can use it.

## AI as a first-class operator

An MCP server is part of the API, not a bolt-on. An AI with a personal access token acts as a real
user, under exactly the same permissions — no elevated path — for three jobs (`docs/07-mcp.md`):

1. **Curating the exercise library** from reliable sources: audit it, search before creating,
   create and correct exercises with consistent muscle attribution, duplicate one to adapt it.
2. **Reviewing someone's training and adjusting it**: adherence, work per muscle, stalled lifts,
   then the plan itself — read, rewrite, duplicate, log a session, read each target and why it
   moved or held, set one by hand.
3. **Diagnosing a running instance** that belongs to someone else, where there is no shell.
   Curator-only.

It is not a second UI. It has no delete tool, and it does not manage groups, members or tokens:
those are a person's to do, in the app.

## Explicit non-goals (for now)

These are deliberately **not** built. The architecture leaves room for them, but do not implement
them without being asked:

- **An analytics dashboard.** The exercise screen will show one trend — for a weight lift, each
  session's estimated max; for other tracking modes, the top set — and whether the exercise has
  stalled (#5). The stats view — one exercise's sessions and progression steps — is planned as
  its own issue (ADR-0026); charts across exercises or muscles are not.
- **Periodization** — weeks, blocks, mesocycles, a calendar. A plan is a flat list of days.
  Periodization gives a small edge in strength and none in muscle growth (Moesgaard et al., Sports
  Med 2022); training consistently matters more. A deload is the AI saving a lighter plan, prompted
  by the review's signals (#6).
- **Working offline.** A set logged without a signal is kept and sent when one returns (#9), but
  nothing else is: starting a session, editing a plan and reading history need the server.
- **A native app in a store, or on Android.** The iPhone app — one build for every instance, the
  server entered at runtime — is installed with AltStore Classic, from each instance (ADR-0032).
  A listing on the App Store is #81; Android is not built.
- **Meal planning** — recipes, ingredients, shopping lists, meal prep. Will reuse the ownable/
  sharing machinery unchanged; see `docs/playbooks/add-entity.md`.
- **Imperial distances.** Everything is stored metric. Weights already read and are typed in kilograms
  or pounds, per account; distances are metric only. Conversion is isolated to one file
  (`packages/contract/src/units.ts`), so miles and yards are additive.
- **IAM / SSO.** Auth is username and password. The `users.auth_provider` / `users.external_id`
  columns (and the unique index on the latter) exist so OIDC can be added without a schema redesign.
  There is no `AuthProvider` interface in code yet; it is the shape the first OIDC change will add.
- **CDN, cache layer, horizontal scaling.** One database, one API process, one static file server.
