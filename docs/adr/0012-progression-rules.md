# 0012 — Progression rules: linear and double, advance-or-hold only

**Status:** Accepted (2026-08-23)

## Context

A prescribed set needs a rule for how its targets move over time. This is the feature an AI is most
expected to operate — "evaluate my progression and set next week's numbers" — so the semantics must
be unambiguous and identical wherever they are computed.

Lifters genuinely disagree about these semantics, so they were settled with the user rather than
assumed.

## Decision

Five rule kinds, stored as a Zod discriminated union in a JSONB column on `workout_entries`:
`none`, `linear`, `double`, `linear_duration`, and `linear_distance` (added for #14, below).

**`progress()` is a pure function in `packages/contract`.** One implementation, called only by the
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

Both `workout_sets` and `set_logs` carry `is_warmup`. `progress` drops warm-ups before doing
anything else, and a session consisting only of warm-ups is short of its targets. An entry must prescribe
at least one working set, enforced in the contract.

### `linear_duration` for time under load

`tracking: 'duration'` exercises — planks, dead hangs, loaded carries — progress by holding longer,
not by adding weight. `linear_duration` adds seconds on the same advance-or-hold basis.

### `linear_distance` for runs and rows — further, at the same pace

**Amended 2026-10-24 (#14).** `distance_duration` exercises first had no automatic rule: progressing
them was taken to mean going _faster_, a decreasing target that contradicts advance-or-hold. They now
have one that advances the other way: **further, at the prescribed pace.**

A session clears it when every prescribed working set covered at least the target distance and, when
a time is prescribed, at no less than its pace. After `afterSuccesses` such sessions the distance
rises by `incrementMm`, and a prescribed time rises in proportion, to whole seconds rounded **up** —
so a volume step never hides a pace jump, nor asks for a hair more pace. Given `5 km in 30:00,
+500 m`:

| Logged | Next | Why |
| --- | --- | --- |
| `5 km in 30:00` | `5.5 km in 33:00` | covered, exactly at the pace |
| `5 km in 29:00` | `5.5 km in 33:00` | faster — still one step, at the _prescribed_ pace |
| `6 km in 33:00` | `5.5 km in 33:00` | further, and faster than the pace |
| `5 km in 31:00` | hold | covered, but slower than the pace |
| `6 km in 36:30` | hold | further, but slower than the pace |
| `4.8 km in 28:00` | hold | short of the distance, however fast |
| `5 km`, no time | hold | a prescribed pace unrecorded is not met |

And given `5 km, +500 m` with no time prescribed: `5 km` logged, with or without a time, advances to
`5.5 km` — the distance alone decides, and no time is added.

Rejected: a rule that shortens the time — the same distance, faster. Endurance work is
conventionally built by adding volume first and changing intensity deliberately; a pace target is
set from a test or training zones, not lowered by a fixed number of seconds per cleared session. That
is a judgement for the user or the AI, through `workout_save_plan`, and the guarantee stays whole: a
rule never makes a prescription easier, and never makes it faster.

### A prescribed RPE is a ceiling

**Amended 2026-11-02 (#45).** A set could prescribe an RPE and a log could record one, but the rules
never read it: `3 × 8–12 @ RPE 8` advanced on `12, 12, 12 @ RPE 10` exactly as on `12, 12, 12 @ RPE
7`. Autoregulated double progression — what both programming sources in use here prescribe (Helms,
*Muscle & Strength Pyramid*, ch. 4) — adds load when the top of the range is reached *at the
prescribed effort*. Reps reached by grinding to failure are a different signal, and the answer to it
is to hold. The case behind it: an athlete logging every set at RPE 10 was too exhausted to finish
sessions, and their new plan's RPE 7–8 was being undone by a rule that rewarded the grind.

So a prescribed RPE is a **ceiling**, not an aim, and a range is prescribed as its top. A session
**clears** a rep goal only when, besides its reps and weight, **no prescribed working set was rated
more than half a point past the RPE** — the hardest set decides. Given `3 × 8–12 @ 60 kg, RPE 8`:

| Logged | Next | Why |
| --- | --- | --- |
| `12, 12, 12 @ 10` | hold `12 × 60 kg` | every rep there, ground out past the RPE |
| `12, 12, 12 @ 9` | hold `12 × 60 kg` | one rep fewer in reserve than prescribed |
| `12, 12, 12 @ 8.5` | `8 × 62.5 kg` | within half a point |
| `12, 12, 12 @ 6` | `8 × 62.5 kg` | well under it — still one step, never faster |
| `12, 12, 12 @ 7, 8, 9` | hold `12 × 60 kg` | the hardest working set decides |
| `12, 12, 12`, not rated | `8 × 62.5 kg` | judged on reps and weight alone |
| `10, 10, 10 @ 10` at a target of 10 | hold `10 × 60 kg` | the rep climb is held too |

It applies wherever reps are judged — `linear` and both steps of `double` — and nowhere else: a hold
or a run has no reps to leave in reserve, and is never rated (#24). Warm-ups and sets past those
prescribed are not judged, as before.

**Half a point**, because a person logs whole reps in reserve. Against a whole RPE, one rep fewer in
reserve than prescribed holds — the steady one-rep overshoot the case above was rewriting a plan to
stop. Against a half (7.5, written by a coach or an AI) the whole reserve just above it clears;
with no allowance, a person could clear a 7.5 only by logging a full rep easier than asked.
Rejected: **one point**, which waves through that one-rep overshoot every session.

**An unrated set passes, though an unrecorded pace does not.** The asymmetry is deliberate. A time
is a measurement, and a prescribed pace is defined by it. RPE is a rating the app never requires:
held against it, progression would freeze for anyone who logs without rating, and change under
every log already written. Rejected: treating an unrated set as past its ceiling.

**Why a prescription held is said.** `progress()` answers the next prescription with why it was `Held` — short of its
`targets`, or past its RPE (`effort`, with the hardest set's rating) — and none when it advanced or
had nothing to hold it for. Short of the targets outranks effort; over a run of `afterSuccesses`
sessions the newest that broke it gives the reason, and a run merely too short has none.
`workout_progression` and the logger say it, so a lift held for effort is not read as a stall — by
the athlete, or by an AI about to deload it. `progress()` replaced `nextTarget()`, which answered
the prescription alone.

## Consequences

- A session **clears** a rep goal only when every prescribed set reached it at no less than the
  target weight, none rated more than half a point past a prescribed RPE. A partially logged
  session cannot earn a promotion — otherwise logging one set of an intended three would advance
  the weight.
- Adding a rule kind means extending the union and `progress`, with **no migration**.
- At a target's ceiling (`MAX_WEIGHT_G`, `MAX_DURATION_S`, …) every rule holds: a suggestion past
  it would fail the API's own response schema, and with it the plan's whole progression and the
  logger's pre-fill.
- Because the rule is read back from JSONB, `progress` guards its switch with a `never` check that
  throws on an unknown kind, rather than silently returning the target unchanged.
- The truth table above is encoded verbatim in `packages/contract/src/progression.test.ts`. If the
  semantics are ever revisited, that file is the specification to change first.
