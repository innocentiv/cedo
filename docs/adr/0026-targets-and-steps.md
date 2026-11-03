# 0026 — A person's target is stored as steps; a plan only says where it starts

**Status:** Accepted (2026-11-03). Supersedes, in part:

- [0012](0012-progression-rules.md): the logger and `workout_progression` "differ only in which
  sessions they read", and the logger's target "carried forward over the sessions that started
  before it" (Decision); "An entry has one weight; its sets never diverge", now true only under a
  rule; "the hardest set decides" in "A prescribed RPE is a ceiling", now each set against its
  own; and in "Why a prescription held is said", the hold for effort "with the hardest set's
  rating" and "the newest that broke it gives the reason" — a step now says its own session's
  reason, per set ("held: set 3 did 7 of 10"). Its truth tables stand otherwise; its half-point allowance is
  [0027](0027-reps-in-reserve-whole-everywhere.md)'s.
- [0024](0024-targets-follow-the-athletes-equipment.md): its amendment's "progression is one step
  from the plan, never accumulated", and its Consequences' "a target is … computed on read …
  Nothing is stored". Its snapping, and its minimum of one loadable weight up, stand — see
  "Equipment" below.

## Context

ADR-0012 computes a session's target on read, as the plan's prescription carried forward by its
rule. The code carried it **one step**: `progress()` judges the latest session against the plan's
own numbers, so a double progression planned at 8 × 55 kg asked for 9 after a cleared session, and
9 again after the next, forever — the plan had to be rewritten after every advance (ADR-0024 noticed
"progression is one step from the plan, never accumulated" while building #36, and worked around
it). The editor showed only the plan, so nobody could see what the logs had done to it.

The same review found states the contract accepts and nothing can mean:

- **A rep target outside its rule's range** — double 8–12 at 4 reps climbs 4, 5, 6…; at 15 it is
  treated as the top and asks for 12.
- **A reversed range** — `[12, 8]`, silently swapped.
- **Working sets that differ under a rule.** The glossary, the editor (`prescribe`) and progression
  (`prescriptionOf`, the first working set) all assume one prescription per entry; the contract never
  required it. An AI wrote ramps (RPE 7/8/8, 8/9/10), the editor showed only the first set, and
  progression judged every set against the first set's RPE — so a plan whose last set may go to
  failure held for effort every session.
- **A rule that does not fit the exercise** — a duration rule on a barbell lift (#22). And an
  exercise's tracking mode could be changed after plans and logs used it, breaking that from the
  side.
- **Warm-up sets with no numbers of their own** — a new one copied the working prescription, so
  "two warm-ups" meant two sets at working weight.

Settled with the user over one design session; the vocabulary is `GLOSSARY.md`'s (Prescription,
Target, Step, Manual).

## Decision

### Prescription, target, step

- The **prescription** is what the plan's author set: where each follower starts. The plan is still
  never written to by progression.
- A person's **target** on an entry is what their next session asks. It is their **latest step on
  that entry, if the step was taken against the prescription and rule as they stand — otherwise the
  prescription**.
- A **step** is written **when a session is finished** — or written finished, by `session_log` —
  once for each entry the session trained under a rule: advanced (from → to) or held (and why), with
  any streak toward `afterSuccesses`, and the prescription and rule it was taken against. It is
  dated by the start of the session it judged, not by when it was written. A step is also written when a person
  **sets their target by hand**, dated then.
- The rule runs **once**, on finish, against the target — not on every read against the plan.

### Resets are derived, never written

Editing a prescription, or its rule, writes nothing to anyone's steps. A step simply stops counting
while what it was taken against has changed, so every follower's target is the new prescription. Put
the old one back and the steps count again for every follower who has not trained since: **a typo fixed loses nothing**, and
the editor needs no confirmation — it says, as information, "your next session restarts from the
plan (you were at 12 × 40)". Plans stay saved as each change is made ([0022](0022-plans-edited-in-place.md)
stands).

What a step is compared against is **what the rule moves or judges**: those dimensions of the
prescription (a linear rule judges reps it never moves), each working set's reps in reserve, and the
rule with its settings. The number of working sets, the
warm-ups, rest, cue, superset and order are not — adding a fourth set at 12 × 40 keeps your target.

### A target differs from its prescription only in what the rule moves

| Rule | What moves | Example: plan 3 × 10 @ 20 kg |
| --- | --- | --- |
| Double, range 8–12, +5 kg | reps, always inside the range, and weight | 10 → 11 → 12 × 20, then 8 × 25 |
| Linear, +2.5 kg | weight | 10 × 20 → 10 × 22.5 → 10 × 25 |
| Linear on a duration exercise | seconds | 30 s → 35 s |
| Distance | distance, and a prescribed time in proportion | 5 km in 30:00 → 5.5 km in 33:00 |

A target set by hand obeys the same limit: under double, reps and weight, reps inside the range;
under linear, the weight; seconds; distance, and time in proportion. Changing anything else is a
plan edit. The app sets it through `PUT /workouts/:id/entries/:entryId/target`, MCP through
`target_set`, both one service function, for any entry the person can see — a reader of the plan
included. It is not one of the entry-level writes [0022](0022-plans-edited-in-place.md) rejected:
it writes the person's own step, never the plan. 0012's truth tables are applied to the target instead of
the plan, unchanged but for its effort table (per set, here; whole, in 0027).

### Corrections take steps again

Any change to the finished sessions of an entry — a set corrected or removed (#31), a session
deleted, a finished session logged afterwards with an earlier date (`session_log`) — takes every
step from the earliest changed session onward again, in the transaction that made the change. A
step set by hand is kept where it stands in time; the sessions after it are judged from it.

### The streak

A rule that waits for `afterSuccesses` cleared sessions in a row reads the streak from the latest
step that counts, and the new step carries it on: one more when the session cleared, none when it
held, none again once it advanced. With no step that counts — none yet, or the prescription or rule
changed since — and after a step set by hand, the streak is none. Taking steps again re-derives each
streak in order. The rule's input is therefore the target, the streak, and the one session being
judged; it never reads a run of past sessions.

### Two modes, by the rule

- **Under a rule** the dimensions the rule moves or judges are shared by every working set (reps
  and weight under linear and double; seconds; distance and time); **reps in reserve may differ per
  set** (reps in reserve ramp across sets, as both programming sources in use prescribe), and
  **each set is judged against its own**. This fixes the hold described above.
- **Manual** (no rule) asks each working set for its own numbers — top sets, back-offs, pyramids.
  Nothing moves them but an edit to the plan; there is no target and no step. The logger pre-fills
  the plan's numbers, with last time's beside each set.
- Switching a manual entry whose sets differ to a rule first asks to use set 1's numbers for every
  set.

### What the contract refuses

- Under double, a prescription's reps outside `[from, to]`, and a range with `from ≥ to`.
- Under a rule, working sets whose moved or judged dimensions differ.
- A rule that does not fit the exercise's tracking mode — one function in the contract says which
  fit, and the plan save, the editor and MCP all ask it:

  | Tracking mode | Rules |
  | --- | --- |
  | weight & reps, bodyweight & reps | Manual, Linear (weight), Double |
  | duration | Manual, Linear (seconds) |
  | distance & duration | Manual, Distance |

- **Changing an exercise's tracking mode.** It is fixed when the exercise is created; to track a
  movement differently, duplicate it. Allowing it only while unused would need to see plans in
  groups the caller cannot, which [0019](0019-visible-relations.md) forbids.

Each refusal says what to do instead, because an AI learns the model from them.

### Warm-up sets

A warm-up is prescribed on its own line (reps × weight). It is never judged and never moved by a
rule, and is not part of what a step is compared against. What it asks next session is its weight
scaled by the working target — `warm-up weight × target weight ÷ prescribed weight`, down to a
loadable weight — worked out each time, never stored, so editing a warm-up takes effect at once and
restarts nothing. Unscaled when the working prescription has no positive weight.

### Equipment

A session is judged against the weight the person was shown
([0024](0024-targets-follow-the-athletes-equipment.md)), and an advance adds the increment **to that
weight**, moving one loadable weight up at least — 22 kg on 2 kg dumbbells, +1 kg, steps to 24, not
23 snapped back to 22. The step keeps that weight, loadable on their equipment the day it was taken.
Reading it snaps it again to their equipment as it is now, so a changed setup still takes effect at
once. Increases now accumulate from step to step, so 0024's minimum is no longer a workaround but
what keeps a sub-step increment moving.

### Reading it

- The plan editor, under a rule, shows two columns — **Plan** and **Your next session** — always,
  for the viewer's own target; Manual shows one. A target is its person's, not the plan's: a reader
  of a plan opens an entry read-only and can still change their own. A plan's outline adds "next
  12 × 40" to an entry only when it differs.
- The logger says why a target moved or held, per set ("held: set 3 did 7 of 10").
- MCP reads the targets and steps (`workout_get`, `workout_progression`) and sets a target by hand
  (`target_set`). Re-aligning a plan with its targets when a new phase of training starts (after a
  deload, say) is the AI's, through `workout_save_plan`; nothing does it automatically. A button for
  it in the app is left to the stats view's issue.

## Rejected

- **Replaying the history on read** (0012's intent, fully carried). One rule, no new table — but a
  target that depends on every session since the plan was last edited, a lookback the history cap
  (`HISTORY_DEPTH`) cannot honour, and a corrected set from three weeks ago silently changing today.
- **Writing the target into the plan.** One number, but the author no longer owns the plan, a
  shared plan has no one athlete to write for, and "the plan says…" disappears.
- **Resetting targets as a write when a prescription changes.** Autosave sends every keystroke: a
  typo on the way to 12 would reset everyone to 1, and fixing it would not bring them back. Staging
  the plan behind a Save instead only hides the same destructive write behind a button.
- **Set groups — a lead group with the rule, back-offs relative to it.** Covers top set and
  back-offs automatically, at the cost of a new nesting level, a relative-load model, and an editor
  and a truth table that a beginner pays for. A power user who programs back-offs edits numbers on
  Manual, as on paper; the stats view (a separate issue) is what supports them.
- **Every set progressing on its own.** Already rejected in 0012.

## Consequences

- **Something derived from logs is stored.** `docs/03-domain-model.md` said nothing derived from a
  set is stored; steps are, and every write that changes a finished session takes them again. That
  is the price of a target that depends on more than the latest session.
- The rules' maths is unchanged and still pure in the contract; what changes is its input (the
  person's target, not the plan's prescription) and when it runs.
- Existing data: steps start empty, so every target is its prescription. An entry the contract now
  refuses — a rule that does not fit its exercise, reps outside its range, a reversed range, moved or
  judged dimensions that differ across working sets — is turned Manual by the migration, which keeps every
  number it holds; the author picks a rule again.
- `0012`'s "the logger and `workout_progression` differ only in which sessions they read" no longer
  applies: both read the person's target.
