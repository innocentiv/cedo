# cedo

A self-hosted workout tracker shared within groups. This glossary names the domain's concepts. The
tables and invariants behind them are in `docs/03-domain-model.md`, and the two never disagree.

## Ownership and access

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

**Working sets per muscle**:
The work a muscle got: every working set counted toward it by that muscle's share of the
exercise's load. Counts every tracking mode alike, which weight lifted cannot.
_Avoid_: volume per muscle, muscle volume

**Weight lifted**:
Weight × reps over working sets — what a session lifted. Work that carries no load (a plank, a run,
an unweighted pull-up) adds nothing to it, so it is never the measure of whether a muscle trained.
_Avoid_: volume, tonnage

**Weight unit**:
How a person reads and types weights: kilograms or pounds. Their own preference; it changes what
they are shown, never what is stored.
_Avoid_: units setting, locale

## Plans

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
of a plan, or no plan at all.
_Avoid_: workout (that is the plan), training

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
