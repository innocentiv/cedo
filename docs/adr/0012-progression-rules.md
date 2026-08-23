# 0012 — Progression rules: linear and double, advance-or-hold only

**Status:** Accepted (2026-08-23)

## Context

A prescribed set needs a rule for how its targets move over time. This is the feature an AI is most
expected to operate — "evaluate my progression and set next week's numbers" — so the semantics must
be unambiguous and identical wherever they are computed.

Lifters genuinely disagree about these semantics, so they were settled with the user rather than
assumed.

## Decision

Three rule kinds, stored as a Zod discriminated union in a JSONB column on `workout_entries`:
`none`, `linear`, `double`.

**`nextTarget()` is a pure function in `packages/contract`.** One implementation, called by the API,
by the `progression_suggest` MCP tool, and by the logging screen. It is impossible for them to
disagree.

### Double progression advances at the entry level

An entry has **one weight**; its sets never diverge. Given `3 × 8–12 @ 60 kg, +2.5 kg`:

| Logged       | Next              | Why                                                           |
| ------------ | ----------------- | ------------------------------------------------------------- |
| `12, 12, 12` | `8 × 62.5 kg`     | every set cleared the top — add weight, restart at the bottom |
| `12, 12, 10` | hold `12 × 60 kg` | one set missed the top                                        |
| `10, 10, 10` | `11 × 60 kg`      | every set met the current target — climb one rep              |
| `10, 10, 8`  | hold `10 × 60 kg` | one set missed the current target                             |

Rejected: per-set independent progression, where set 1 could sit at 65 kg while set 3 is still at
60 kg. It models within-session fatigue more faithfully, but it makes the prescription hard to read
and forces the UI to show a different target per set.

### It advances or holds. It never decreases.

There is no automatic deload. A stall is surfaced in the UI ("held 3 sessions") and left to the user
or the AI, acting through `workout_update_plan`.

Rejected: automatic deload after N consecutive failures. Classic novice-linear behaviour, but it
needs a failure definition that survives skipped sessions, a floor weight, and a deload percentage —
roughly doubling the truth table — to automate a judgement that depends on context the function does
not have (illness, a bad week, form breakdown). The AI has that context; the pure function does not.

## Consequences

- A session **clears** a rep goal only when every prescribed set reached it at no less than the
  target weight. A partially logged session cannot earn a promotion — otherwise logging one set of
  an intended three would advance the weight.
- Adding a rule kind means extending the union and `nextTarget`, with **no migration**.
- Because the rule is read back from JSONB, `nextTarget` guards its switch with a `never` check that
  throws on an unknown kind, rather than silently returning the target unchanged.
- The truth table above is encoded verbatim in `packages/contract/src/progression.test.ts`. If the
  semantics are ever revisited, that file is the specification to change first.
