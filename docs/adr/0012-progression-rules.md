# 0012 — Progression rules: linear and double, advance-or-hold only

**Status:** Accepted (2026-08-23)

## Context

A prescribed set needs a rule for how its targets move over time. This is the feature an AI is most
expected to operate — "evaluate my progression and set next week's numbers" — so the semantics must
be unambiguous and identical wherever they are computed.

Lifters genuinely disagree about these semantics, so they were settled with the user rather than
assumed.

## Decision

Four rule kinds, stored as a Zod discriminated union in a JSONB column on `workout_entries`:
`none`, `linear`, `double`, `linear_duration`.

**`nextTarget()` is a pure function in `packages/contract`.** One implementation, called only by the
API's progression service, whose answers both the `workout_progression` MCP tool and the logger's
pre-fill render. They cannot compute differently; they differ only in which sessions they read —
every one so far, or those before the session being logged — so they agree whenever none is in
progress.

**The logger is pre-filled with it; the plan is not written to.** A session asks of each entry the
plan's prescription carried forward over the sessions that started before it
(`GET /sessions/:id/targets`, `EntryTarget`) — never over itself, or a session whose sets had all
hit would offer its next set the advanced weight mid-workout. The plan stays what its author
prescribed; progression carries it forward from there. Added after the requirements review (#2):
the target was computed and shown only as a caption, while the logger offered the old weight.

### Double progression advances at the entry level

An entry has **one weight**; its sets never diverge. Given `3 × 8–12 @ 60 kg, +2.5 kg`:

| Logged | Next | Why |
| --- | --- | --- |
| `12, 12, 12` | `8 × 62.5 kg` | every set cleared the top — add weight, restart at the bottom |
| `12, 12, 10` | hold `12 × 60 kg` | one set missed the top |
| `10, 10, 10` | `11 × 60 kg` | every set met the current target — climb one rep |
| `10, 10, 8` | hold `10 × 60 kg` | one set missed the current target |

Rejected: per-set independent progression, where set 1 could sit at 65 kg while set 3 is still at
60 kg. It models within-session fatigue more faithfully, but it makes the prescription hard to read
and forces the UI to show a different target per set.

### It advances or holds. It never decreases.

There is no automatic deload. A stall, a lift falling and effort drift are surfaced by
`training_review` over MCP (the exercise screen shows the stall too) and left to the user or the AI,
acting through `workout_save_plan`.

Rejected: automatic deload after N consecutive failures. Classic novice-linear behaviour, but it
needs a failure definition that survives skipped sessions, a floor weight, and a deload percentage —
roughly doubling the truth table — to automate a judgement that depends on context the function does
not have (illness, a bad week, form breakdown). The AI has that context; the pure function does not.

### Warm-up sets are excluded from progression

Added after the initial design, because the omission was a real defect rather than a missing luxury.
Real sessions ramp up to a working weight. Without a flag, a lifter who logs `10 @ 20kg, 5 @ 40kg`
before `3 × 8 @ 60kg` has the _warm-ups_ evaluated as their working sets — which never clear the
target, so **they would never progress**.

Both `workout_sets` and `set_logs` carry `is_warmup`. `nextTarget` drops warm-ups before doing
anything else, and a session consisting only of warm-ups is not a session. An entry must prescribe
at least one working set, enforced in the contract.

### `linear_duration` for time under load

`tracking: 'duration'` exercises — planks, dead hangs, loaded carries — progress by holding longer,
not by adding weight. `linear_duration` adds seconds on the same advance-or-hold basis.

`distance_duration` exercises (runs, rows) deliberately have **no** automatic rule: progressing them
usually means going _faster_, which is a decreasing target, and that contradicts the advance-or-hold
guarantee. They use `none` and are adjusted deliberately.

## Consequences

- A session **clears** a rep goal only when every prescribed set reached it at no less than the
  target weight. A partially logged session cannot earn a promotion — otherwise logging one set of
  an intended three would advance the weight.
- Adding a rule kind means extending the union and `nextTarget`, with **no migration**.
- Because the rule is read back from JSONB, `nextTarget` guards its switch with a `never` check that
  throws on an unknown kind, rather than silently returning the target unchanged.
- The truth table above is encoded verbatim in `packages/contract/src/progression.test.ts`. If the
  semantics are ever revisited, that file is the specification to change first.
