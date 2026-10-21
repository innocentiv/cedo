# cedo

A self-hosted workout tracker shared within groups. This glossary names the domain's concepts. The
tables and invariants behind them are in `docs/03-domain-model.md`, and the two never disagree.

## Ownership and access

**Group**:
People who own things together. Every person has a personal group of their own, so "mine" and
"shared" are the same mechanism.
_Avoid_: team, organisation

**Editor** / **Reader**:
A member's role in a group: an editor can change what the group owns and who belongs to it; a
reader can only read it.
_Avoid_: admin, viewer, owner

**Leave**:
A member removing themselves from a group, in either role. The group's last editor cannot, and
nobody leaves their personal group or the library.
_Avoid_: quit, unsubscribe

**Library**:
The starter exercises every account can read. Every account belongs to its group from the start
and keeps belonging, which is why any shared plan may use them.
_Avoid_: catalogue, defaults

**Curator**:
An editor of the library's group, who may audit and tidy the library.
_Avoid_: admin, moderator

**Owning group**:
The group an exercise or workout belongs to. It alone decides who may read or change the thing.
_Avoid_: owner (as a user), author

**Ownable**:
Something that can be shared, transferred, duplicated and favourited: today, an exercise or a
workout.
_Avoid_: resource, entity

**Child** (of an ownable):
A part that exists only inside one ownable and belongs to its owning group: a workout's days,
entries and sets, or an exercise's muscles and media.
_Avoid_: sub-resource

**Visible**:
Readable by a caller, because they belong to the owning group in any role.

**Editable**:
Changeable by a caller, because they are an editor of the owning group.

**Unavailable exercise**:
An exercise a plan or a log still refers to that the reader can no longer see. Its name is
withheld, and nothing new can be logged against it.
_Avoid_: deleted exercise, hidden exercise

**Access token**:
A credential a person makes for an AI to act as them, under exactly their permissions. Shown once.
_Avoid_: API key, password

**Visible relation**:
The rows of an ownable, or of its children, that one caller may read. It is the only form in which
a read sees them.
_Avoid_: scope, filtered table, view

## What can be done with an ownable

**Scope**:
Which slice of the visible ownables a list shows: all of them, the caller's own (mine), the
caller's favourites, or one group's.
_Avoid_: filter, view

**Favourite**:
A per-user pin on an ownable. Pinning needs only that the ownable is visible.
_Avoid_: bookmark, star

**Transfer**:
Moving an ownable, children and all, to another owning group. It needs editor rights on both groups.
_Avoid_: move, share

**Duplicate**:
Copying a visible ownable into a group the caller can edit, so a read-only one can be changed as
their own.
_Avoid_: clone, fork

## Measurement

**Tracking mode**:
What an exercise measures: weight and reps, bodyweight reps (with optional added weight), a
duration, or a distance over a duration.
_Avoid_: exercise type, measurement type

**Dimension**:
One measured quantity: weight, reps, duration or distance. A tracking mode is a set of them.
_Avoid_: measure, metric

**Effort**:
The dimensions one set carries — prescribed as a target, or done as a log.
_Avoid_: result, performance

**RPE**:
How hard a set was, or is meant to be: 5 to 10 in half-points, where 10 leaves no rep in reserve
and each point below it leaves one more.
_Avoid_: intensity, difficulty, exertion

**Reps in reserve**:
How many more reps a set could have had — how RPE is asked of a person: none to five, in halves.
_Avoid_: reps left in the tank, RIR (in what a person reads)

**Working sets per muscle**:
The work a muscle got: every working set counted toward it by that muscle's share of the
exercise's load. Counts every tracking mode alike, which weight lifted cannot.
_Avoid_: volume per muscle, muscle volume

**Declined muscle**:
A muscle that got half or less of the working sets per muscle it got in the preceding period of the
same length, having had at least two.
_Avoid_: dropped muscle, abandoned muscle

**Top set**:
A session's best working set of one exercise, as its tracking mode ranks efforts: the heaviest
lift, then the most reps at it; the most weight added to bodyweight; the longest hold; the farthest
run, then the fastest over it.
_Avoid_: best set, max set

**Stalled**:
An exercise whose latest sessions — three or more running — share one top set: what was logged has
stopped moving. Judged on the logs, not on a plan, so an exercise logged without one can stall too.
_Avoid_: plateaued, stuck

**Weight lifted**:
Weight × reps over working sets — what a session lifted. Work that carries no load (a plank, a run,
an unweighted pull-up) adds nothing to it, so it is never the measure of whether a muscle trained.
_Avoid_: volume, tonnage

**Weight unit**:
How a person reads and types weights: kilograms or pounds. Their own preference; it changes what
they are shown, never what is stored.
_Avoid_: units setting, locale

## Plans

**Workout**:
A named course of training someone follows — Push/Pull/Legs, a five-week block. It is an ownable: shared,
transferred, duplicated, favourited as one.
_Avoid_: routine, program, programme, template

**Plan**:
A workout's days and entries, changed together as one. "Start from a plan"
means starting a session from one of its days.
_Avoid_: schedule, layout

**Day**:
One training day of a workout's plan, holding its entries in order.
_Avoid_: session (that is a day trained), split

**Entry**:
One exercise on a day: its prescription, its sets, and how it progresses.
_Avoid_: slot, item, exercise (that is the movement itself)

**Superset**:
Entries of one day performed alternating, marked by a shared letter.
_Avoid_: circuit, pairing

**Progression rule**:
How an entry's prescription advances from what was logged: none, linear, double, or linear in
duration.
_Avoid_: program, scheme

**Prescription**:
What an exercise in a plan asks for on every working set: one set of targets, shared by all of
them. Progression advances it.
_Avoid_: target set, template

**Working set**:
A set that counts: it carries the prescription, and progression judges it.
_Avoid_: main set, real set

**Warm-up set**:
A lighter ramp-up set before the working sets. It is not judged by progression, and counts toward
neither working sets per muscle nor weight lifted.
_Avoid_: ramp set, prep set

## Training

**Session**:
One visit to the gym: when it started and ended, and the sets logged in it. It may follow a day
of a plan, or no plan at all. A session is in progress until it is finished, and finishing is final:
a finished session takes no more sets, and none are undone. A person has at most one session in
progress.
_Avoid_: workout (that is what a session follows), training

**Set log**:
One set as it was done: the exercise, its effort, and — when the session follows a plan — the plan
entry it answers. It belongs to the session, and keeps its effort even when its exercise or plan is
later out of reach.
_Avoid_: entry (that is the plan's), result

**Series**:
The sets of one plan entry within a session — or, for sets logged with no plan entry, of one
exercise. A set whose plan entry is gone — removed from the plan, or out of the lifter's reach —
counts as logged with none. A set's number counts within its series, warm-ups included, in the
order performed: one past the highest, so a number below it is never given again, while undoing
the last set lets the next take its number.
_Avoid_: group, block
