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

**Share training**:
A member's own switch, per group, letting that group's editors read their training: sessions, sets
and the training review, never to change. Off until they switch it on; off again, or the member
gone from the group, nothing of it is readable, the past included. Not offered in a personal group
or the library.
_Avoid_: publish, follow

**Athlete**:
A member who shares their training with a group, as that group's editors see them.
_Avoid_: client, trainee

**Coach**:
An editor of a group whose members share their training with it. Not a role of its own: a coach
reads an athlete's training and changes none of it, and may write athlete notes about them.
_Avoid_: trainer, admin

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
What an exercise measures: weight and reps, bodyweight reps (with optional added weight, or
assistance), a duration, or a distance over a duration.
_Avoid_: exercise type, measurement type

**Assistance**:
Help on a bodyweight movement: a band, an assisted machine. Recorded as negative added weight, so a
band worth 20 kg is −20 kg and less help is simply heavier, on the way to bodyweight and then added
load. Help is not load, so it adds nothing to weight lifted.
_Avoid_: counterweight, negative load

**Dimension**:
One measured quantity: weight, reps, duration or distance. A tracking mode is a set of them.
_Avoid_: measure, metric

**Effort**:
The dimensions one set carries — prescribed as a target, or done as a log.
_Avoid_: result, performance

**RPE**:
How hard a set was, or the most a set is meant to take: 5 to 10 in half-points, where 10 leaves no
rep in reserve and each point below it leaves one more. Prescribed, it is a ceiling, not an aim: a
range such as 7–8 is prescribed as its top.
_Avoid_: intensity, difficulty, exertion

**Reps in reserve**:
How many more reps a set could have had — how RPE is asked of a person: none to five, whole. A half
written by a coach or an AI is still a reserve, and reads as one.
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

**Estimated max**:
The most weight a set suggests could be lifted once, worked out from its weight, its reps and the
reps it left in reserve — so sets of different rep counts can be compared.
_Avoid_: e1RM, 1RM, one-rep max, max (a one-rep max is lifted, not estimated)

**Stalled**:
An exercise whose latest sessions — three or more running — share one top set: what was logged has
stopped moving. Judged on the logs, not on a plan, so an exercise logged without one can stall too.
_Avoid_: plateaued, stuck

**Falling**:
A weight lift whose best estimated max, from the weight and reps lifted alone, has dropped in each
of its latest two sessions or more — performance going down, not just not going up. One bad session
is not a fall, and a set rated harder is effort drift, not a fall.
_Avoid_: regressing, declining (a declined muscle is about sets, not strength)

**Effort drift**:
The same set — the same weight and reps — rated at least one RPE harder in each of the latest two
sessions than it was before them. One hard set, or one hard day, is not drift.
_Avoid_: fatigue (drift is what was rated, not what was felt)

**Deload**:
A planned stretch of lighter training to shed accumulated fatigue. Falling and effort drift are its
triggers; a deload is saved as a lighter plan, never applied by the progression rule on its own.

**Weight lifted**:
Weight × reps over working sets — what a session lifted. Work that carries no load (a plank, a run,
an unweighted pull-up) adds nothing to it, so it is never the measure of whether a muscle trained.
_Avoid_: volume, tonnage

**Weight unit**:
How a person reads and types weights: kilograms or pounds. Their own preference; it changes what
they are shown, never what is stored.
_Avoid_: units setting, locale

## Equipment

**Equipment**:
What an exercise is done with — dumbbells, a barbell, a rack, a low pulley. An exercise needs some;
an athlete has some.
_Avoid_: gear, tools, gym setup

**Weight step**:
The smallest change in load an athlete's equipment allows: their dumbbells go up 2 kg at a time,
their plates 2.5 kg a pair. Not the progression rule's increment, which is how much a plan adds
when it advances.
_Avoid_: increment (that is the progression rule's), plate step

**Loadable weight**:
A weight an athlete's equipment can put on an exercise: the lightest of the item holding its load,
then a weight step at a time, up to the heaviest. A plan's weight is shown as the heaviest loadable
weight not above it — or the lightest, under it — and a set is judged against that. When a plan
moves up, it moves up a loadable weight at least.
_Avoid_: available weight, real weight, snapped weight

**Doable**:
An exercise an athlete has all the equipment for. One whose equipment nobody has described yet
counts as doable for everyone, and so does every exercise for an athlete who has not described
what they have. Not doable hides an exercise from what is suggested; it never stops it being
planned or logged.
_Avoid_: available, in reach (those are about who can see an exercise)

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
How an entry's prescription advances from what was logged: none, linear, double, linear in
duration, or linear in distance at the same pace. It advances once the prescription is cleared, or
holds; it never makes the prescription easier, and never makes it faster.
_Avoid_: program, scheme

**Cleared**:
What a session does to a prescription when every working set reached its targets without going
more than half a point past its RPE. A set nobody rated, or a prescription with no RPE, is judged on
its targets alone. A set short of its targets, or ground out past its RPE, holds the prescription.
_Avoid_: clean, hit, success

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
a finished session takes no more sets. What it holds is still its lifter's to fix, with no time
limit: a set corrected or removed, or the whole session deleted. A person has at most one session
in progress.
_Avoid_: workout (that is what a session follows), training

**Personal best**:
A working set better than every earlier working set of its exercise, of which there was at least
one: for a weight lift, by the estimated max of what was lifted; for a bodyweight movement, by reps, or by weight added once any is; for a hold, by
time held; for distance over time, by distance, then by pace over the same distance.
_Avoid_: PR, record

**Current workout**:
The workout someone is following now: the one their most recent session followed a day of, of those
they can still see. Training on a workout makes it current; nobody chooses it, and a session without
a plan leaves it as it was.
_Avoid_: active plan, selected workout

**Next day**:
The day of the current workout that comes after the one trained last, in the plan's order, back to
the first after the last. A day removed from the plan since it was trained is passed over.
_Avoid_: today's workout, scheduled day

**Set log**:
One set as it was done: the exercise, its effort, and — when the session follows a plan — the plan
entry it answers. It belongs to the session, and keeps its effort even when its exercise or plan is
later out of reach.
_Avoid_: entry (that is the plan's), result

**Athlete record**:
Something kept about a person, to be read when their training is planned: an athlete note, or a
weigh-in. Read by the person and by everyone who reads their training; written by the person or a
coach of theirs; removed by whoever wrote it, or by the person it is about.
_Avoid_: personal data, profile

**Athlete note**:
An athlete record of a standing fact, written down to be remembered when their training is
planned: an injury, a preference, what they said of a plan, a week away. Not of one session, nor of
one plan. Whoever wrote one may also change its words.
_Avoid_: comment, feedback, memo

**Weigh-in**:
An athlete record of a person's bodyweight on one day; another that day replaces it. The latest is
their bodyweight, and the ones before it are its trend.
_Avoid_: measurement (that is what a set records), body stat

**Series**:
The sets of one plan entry within a session — or, for sets logged with no plan entry, of one
exercise. A set whose plan entry is gone — removed from the plan, or out of the lifter's reach —
counts as logged with none. A set's number counts within its series, warm-ups included, in the
order performed: one past the highest, so a number below it is never given again, while undoing
the last set lets the next take its number.
_Avoid_: group, block

**Focus**:
What a session in progress puts forward to log next: an entry of its day, or an exercise logged
with none. The one the athlete chose, else where the day's order leads; a choice holds until they
log or undo a set, or add an exercise, which then takes the focus.
_Avoid_: current exercise, active entry, selected entry

**Swap**:
An exercise done in a session that follows a plan without being an entry of its day, in place of
one or beside them. Its sets are logged with no plan entry, so they are a series of their own.
_Avoid_: substitution, extra (an extra is a set beyond what an entry prescribes)
