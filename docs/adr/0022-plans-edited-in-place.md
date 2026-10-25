# 0022 — A workout's plan is edited in place, saved as each change is made

**Status:** Accepted (2026-10-25)

## Context

A workout's plan was changed in a separate editor: *Edit plan* opened a form of every field of every
entry, nothing was kept until *Save plan*, and leaving any other way discarded the lot. The detail
and the editor were two pictures of one plan, and a twenty-entry plan was a form several metres
long (`docs/ux/2026-10-ui-review.md`). The redesign makes the workout's page its outline — days, and
each entry as one line — and opens one entry's settings from it (#23).

Editing in place needs a rule for when a change is stored, and the plan is saved whole: `PUT
/workouts/:id/plan` replaces days and entries together, keeping the ids sent back so logged history
stays attached (`docs/06-api.md`, "Nested resources: replace, do not patch"), and refuses a plan the
schema would — `planIssues` in the contract says so before the request.

## Decision

**Each change is saved as it is made, by the whole-plan save, and nothing else is stored.**

- A change — a target, a set count, a rule, an entry added, moved or removed — sends the plan as it
  now stands, ids included. There is no Save, no mode, and no draft.
- **The editor offers only changes the schema accepts**, as it largely does already: what it models
  it prevents, and `planIssues` is read before sending. A change the server still refuses — an
  exercise out of the caller's reach, a limit — is undone on screen with the server's reason beside
  it. The stored plan is therefore always one the schema accepts, and always the one in use.
- **Saves of one workout run one at a time, in the order made**, as a session's sets do (#9), so a
  quick run of changes cannot arrive out of order.
- **A save carries the version it was made from, and a stale one is refused.** A workout gains a
  version, raised by every plan save; a save made from an older one is a conflict, and the editor
  reloads the plan and says it changed elsewhere. Two devices open on one workout cannot quietly
  overwrite each other.
- Editing a workout while a session follows it is allowed: the session reads the plan as it stands.

## Rejected

- **A stored draft beside the plan.** Saving every change into a draft that may be invalid, then
  publishing it, keeps the editor free to pass through invalid states — at the price of a second copy
  of every plan, a publish step that is the old Save under another name, and a session started
  mid-edit following which of the two.
- **Entry-level writes** (`PATCH /workouts/:id/entries/:entryId`, …). Smaller requests, but a family
  of routes that must each re-check what the whole-plan save checks once — the limits, the ordering,
  the exercises in reach — and every one a place to forget it.
- **The last save wins.** Simplest, and silent: a laptop left open on an old copy undoes this
  morning's changes from the phone, and nobody is told.
- **Keeping an explicit Save.** The defect being fixed.

## Consequences

- `workouts` gains a version, and the plan save a precondition on it; a refusal is a `409` the
  editor answers by reloading. The version is optional on the save (`PlanSave`): the workout page
  and an AI that read the plan (`workout_get_editable` returns it) send it, and a caller writing a
  plan it composed whole, with no earlier copy to have gone stale, may leave it out and replace
  unconditionally. Renaming a workout or its notes leaves the version alone: it guards the plan.
- Editing a plan needs a signal, unlike logging a set: a change made offline is not queued.
- Saving whole on every change sends the plan each time — a few kilobytes for a large plan, which a
  self-hosted instance on a NAS takes in its stride.
