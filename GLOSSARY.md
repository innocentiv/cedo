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
An editor of the library's group, who may audit and tidy the library, read the instance's
diagnostics, and open or close its sign-up. A fresh instance's first account (ADR-0029).
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
assistance), a duration, or a distance over a duration. It decides which progression rules fit the
exercise, and is fixed once the exercise exists: a movement tracked another way is another
exercise.
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
The dimensions one set carries — prescribed, asked of a person as their target, or done as a log.
Not how hard it was: that is its reps in reserve. Two fixed phrases keep the everyday sense, and
mean reps in reserve: **held for effort** and **effort drift**.
_Avoid_: result, performance

**Reps in reserve**:
How many more reps a set could have had, or the fewest a working set is meant to leave: none to
five, whole, and nothing between. Prescribed, it is a floor, not an aim: a range such as 1–2 is
prescribed as its bottom, and a set that left fewer than asked was ground out past it. Each working
set may ask its own, so how hard the sets are taken can ramp across them. The one rating of how hard
a set was — for a person and an AI alike.
_Avoid_: RPE (the same measure, written as ten minus it — never read or written), reps left in the
tank, RIR, intensity, difficulty, exertion

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
The same set — the same weight and reps — left at least one rep fewer in reserve in each of the latest two
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
their plates 2.5 kg a pair. Not the progression rule's increment, which is how much a target adds
when it advances.
_Avoid_: increment (that is the progression rule's), plate step

**Loadable weight**:
A weight an athlete's equipment can put on an exercise: the lightest of the item holding its load,
then a weight step at a time, up to the heaviest. A target's weight is shown as the heaviest
loadable weight not above it — or the lightest, under it — and a set is judged against that. When a
target moves up, it moves up from the weight shown, by a loadable weight at least. A target at the
heaviest is at the athlete's heaviest, however it got there: there is nothing heavier for it to move
to.
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
transferred, duplicated, favourited as one. Its notes say how it is run — effort, block structure,
deload, what to do on a bad day — and are not part of its plan. What is true of the person following
it, such as their equipment or an injury, is theirs to keep, not the workout's.
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

**Round**:
One pass through a superset's entries that still have sets, each done once, in the day's order.
The rest comes after it, not within it.
_Avoid_: pair (a superset may hold more than two), cycle, lap

**Progression rule**:
How a person's target on an entry moves from what they logged: none, linear, double, linear in
duration, or linear in distance at the same pace. Each finished session advances the target once
enough sessions running have cleared it, or holds it; it never makes the target easier, and never
makes it faster. Which rules an
entry may have follows from its exercise's tracking mode.
_Avoid_: program, scheme

**Manual**:
An entry with no progression rule. Nothing moves its numbers but an edit to the plan, and each of its
working sets may ask for different ones — a top set and its back-offs, a pyramid.
_Avoid_: custom, free, none (in what a person reads)

**Cleared**:
What a session does to a target when every working set reached it and left at least the reps in
reserve that set asked. A set nobody rated, or one that asked no reserve, is judged on its dimensions
alone. A set short of the target, or ground out past its reserve, holds it.
_Avoid_: clean, hit, success

**Held**:
What a session does to a target it does not clear, and why: short of the target, or ground out past
its reserve. Short of the target is the reason given when both are true. A target held for effort is not
stalled: the lift is there, done harder than asked.
_Avoid_: stalled, failed. Also not a hold, which is a timed set such as a plank.

**Prescription**:
What the author of a plan set an entry's working sets to ask for. Under a progression rule, the
dimensions the rule moves or judges are shared by every working set, and only the reps in reserve
may differ from set to set; a manual entry asks each working set for its own. It is where each follower's target
starts. Changing what it asks, or its rule, starts every follower's target again from it — and
changing it back restores the target of each follower who has not trained since. How many working
sets there are, and the warm-ups, are not part of what it asks.
_Avoid_: target (that is a person's, and moves), target set, template

**Target**:
What an entry asks of one person in their next session: their latest step, if it was taken against
the prescription and rule as they stand, and the prescription otherwise. It moves only by the
entry's progression rule, one step per finished session, or when set by hand, and starts again from
the prescription when that or its rule changes — and differs from the prescription only in what the
rule moves. Two people following one plan each have their own; a
manual entry has none. The sessions behind it are those since it last started — from the
prescription, or set by hand — not every session the entry was ever trained in.
_Avoid_: prescription (that is the author's, and stays), goal, next weight

**Step**:
What one finished session did to a person's target on an entry — advanced it, from what to what, or
held it, and why — or the person setting it by hand. Each step is taken against the prescription and
rule as they stood when it was taken, and counts only while they still stand. Any change to a finished session takes its steps
again, and every session's step after it; a step set by hand stays where it stands.
_Avoid_: event, change, history entry

**Working set**:
A set that counts: it carries the prescription, and progression judges it.
_Avoid_: main set, real set

**Warm-up set**:
A lighter ramp-up set before the working sets, prescribed on its own line. It is not judged by
progression, and counts toward neither working sets per muscle nor weight lifted. Its weight follows
the working target in proportion — what it asks next session is worked out each time, never kept —
so changing it restarts no target. On a manual entry, or with no positive working weight to follow,
it asks what it says.
_Avoid_: ramp set, prep set

**Cue**:
What an entry tells the athlete about doing it, in a line — "pause 1 s at the chest" — shown under
the exercise as they log it. Not how the entry progresses or how hard to go: that is its progression
rule and reps in reserve, or the workout's notes.
_Avoid_: note, tip, instruction (that is the exercise's, the same in every plan)

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
log a set or go to pick an exercise, and what they pick takes the focus. A set undone chooses its
own entry, to be logged again, until the next set is logged.
_Avoid_: current exercise, active entry, selected entry

**Rest**:
The pause after a set, before the next. It starts when a set is logged, and ends when its time is
up, when it is skipped, or when its set is undone. A superset rests after the round, not within
it: the rest of the entry that ends it.
_Avoid_: timer, break, recovery

**Undo**:
Taking back the set just logged, where it was logged: while its rest runs, or — with none after it —
until the next set. It ends the rest, and nothing is just logged again until the next set. Any
other set is corrected or removed instead, at any time.
_Avoid_: rollback, revert

**Swap**:
An exercise done in a session that follows a plan without being an entry of its day, in place of
one or beside them. Its sets are logged with no plan entry, so they are a series of their own.
_Avoid_: substitution, extra (an extra is a set beyond what an entry prescribes)
