# UI review — October 2026

A walk through every screen of the app as an athlete meets it, against what the API can already do,
to settle what the redesign (#23 and after) should be. It records **findings**, and a **proposal**
to be decided on; the decisions themselves go into `GLOSSARY.md`, `docs/08-frontend.md` and ADRs as
they are made, not here. This file is a snapshot: once its decisions are recorded, it is history.

## How it was looked at

`bun run gallery` (`apps/app/e2e/gallery.ts`) seeds one athlete as they look three weeks into a
block — an Upper / Lower plan of four days and twenty-one exercises, twelve finished sessions dated
across those weeks, a session half done with rest running, an exercise of their own with a video,
a coach's club they share their training with — and photographs every screen and the states inside
them (the picker open, a set mid-rest) at a phone's width (420) and a laptop's (1440), down to the
end of each page. `.artifacts/gallery/index.html` lays the two side by side.

Before it, the only pictures were `shot` (one route, an empty account, cut at the fold) and the end
state of each journey. Neither showed the app in use, which is where every problem below lives.

## The athlete's day, step by step

### 1. Opening the app — Today

- **It does not say what to do today.** "Nothing in progress", then *Start from a plan* — which goes
  to the plan LIST, where you open the plan, find the day, and start it: four taps to begin the
  session the app could have predicted (the day after the last one done of the plan in use).
- **History is one number per session.** Each row is a day name, a date (`23/10/2026`) and "7590 kg
  lifted". No duration, no sets, no exercises, no sign of progress or of a personal best; no week
  grouping. Weight lifted is the only measure, and it says nothing for a plank or a row.
- **A session in progress is a small row** ("Lower A · 1 sets logged" — grammar included), not the
  thing on the screen. The history list stays the same size under it.

### 2. Doing the session — the live screen

The most important screen, and the one most in the way.

- **Every exercise is a full logger at once.** Five exercises is five forms: two inputs, eleven
  reps-in-reserve chips, a "Log set" button, a cue, a progression line, a "last time" line — about
  450px each on a phone. Doing the third exercise means scrolling past two finished ones.
- **There is no set list.** An exercise says "1 done". Which set is next, whether it is a warm-up,
  how many remain, what each one asked for — none of it is on screen. The plan's two warm-ups
  before the squat exist only as "1 done" not counting them.
- **Logged sets live in a list at the very bottom**, apart from their exercise, and a warm-up reads
  "set 1" like any other.
- **Rest is a line of text** ("Rest 1:58") inside the card of the exercise just done — easy to miss
  from across the gym, and gone once you scroll.
- **Reps in reserve is asked before the set**, of every set, for every kind of exercise — a plank is
  offered "3½ in reserve". It is the largest control on the screen and the least used.
- **How to do the exercise is not reachable.** The cue line shows, but the description, the
  instructions and the video are on the exercise screen, in another tab.
- **Supersets are not shown at all.** Upper A pairs Face Pull and Lateral Raise as `A`; the logger
  presents them as two unrelated exercises, in order, so the pairing is lost when it matters.
- **Finish is one tap, always on screen**, beside the thumb — and finishing is final (GLOSSARY.md).
- **The tab bar stays**, four destinations to wander to mid-set.
- **Progression is spelled out twice per exercise** ("Progressed to 5 × 102.5 kg · the plan says 5 ×
  100 kg", then "Last: 5, 5, 5, 5, 5 × 105 kg") in blue body text, competing with the numbers.

### 3. Plans — list, detail, editor

- **The list says only "4 days".** Not when it was last done, what is next, or which is in use.
  Creating one is a name field and Create at the foot of the list.
- **The detail shows raw enum names**: `linear`, `double`, `linear_duration`, `linear_distance` —
  `describeProgression` exists in the contract and is not used here. The plan's notes are never
  shown, nor any day's rest, cue or warm-ups.
- **The editor is every field of every exercise, expanded.** Warm-ups, sets, weight, reps, eleven
  reserve chips, rest, cue, five superset chips, five progression chips and their settings: about
  600px per exercise, so a 21-exercise plan is a form several metres long. There is no outline, no
  collapse, no way to see a day at a glance while editing it.
- **Edit is a mode.** *Edit plan* opens the form; nothing is kept until *Save plan*; leaving any other
  way discards it. The detail and the editor are two different pictures of one plan.
- **Order is fixed.** A day moves up (`↑`); an exercise cannot move at all — removing and re-adding
  it is the only way, and it loses its settings.
- **A plan cannot be renamed, nor its notes edited** — `PATCH /workouts/:id` exists and the app never
  calls it.
- **The cue's placeholder is "Pause 1 s at the chest"** on every exercise, the Romanian deadlift
  included.

### 4. Finding an exercise — the library and the picker

- **The library is an alphabetical list** with a search box and All / Mine / Pinned. The API filters
  by muscle (`GET /exercises?muscle=`); the app offers no way to.
- **The picker is the same list, full screen, over the editor**, with each row's equipment only — no
  muscles, no tracking mode, nothing recently used, nothing already in the day.
- **An exercise's page is a stack of sections**: Pin, its group, a description, muscles as text, media
  as a row reading `video_link` (the raw kind; the contract's `embedUrl` and `thumbnailUrl` go
  unused), and history. Your own exercise lists its muscles alphabetically, not by load.
- **History mixes warm-ups into working sets and truncates them** ("5 × 40 kg, 5 × 60 kg, 5 × 105 kg,
  5 × 105 kg, 5…"); the progress chart has bars with no dates and no scale.

### 5. Settings, groups, tokens

Workable, and least in need of change: a list of cards and buttons. The group screen gained the
sharing switch (#11).

### 6. Desktop

**The phone, centred.** At 1440 the content is a 690px column in the middle of the page and a bare
sidebar — no product name, no account, no use of the width. A plan's days, an exercise list and its
detail, a session's whole day: everything that would be read side by side is read one under the
other.

## What the API can do that the app cannot

| Capability | API | App |
| --- | --- | --- |
| Training review — adherence, skipped days, work per muscle, stalls, falling, effort drift | MCP `training_review` (no HTTP route) | none |
| Progression suggestions for a whole plan | `GET /workouts/:id/progression`, MCP `workout_progression` | none (only the logger's pre-fill) |
| Rename a plan, edit its notes | `PATCH /workouts/:id` | none |
| Session notes | `PATCH /sessions/:id` (`notes`) | none — written by MCP, never shown or editable |
| Filter exercises by muscle | `GET /exercises?muscle=` | none |
| Video and thumbnails for media | `Media.embedUrl`, `thumbnailUrl` | a text row |
| A coach reading athletes | `/athletes/…`, MCP | none (#23) |
| Library audit, platform status | MCP (curators) | none |

## A proposal: one thing at a time

The athlete's job in the gym is narrow and repeated: *what is next, do it, write it down, rest*.
Everything else — the plan's structure, history, progress — is read before or after. The screens
should be shaped around that loop, and the editor around a plan's outline.

### The session: a focus on the next set

```
┌──────────────────────────────┐
│ Lower A          12:04   ⋯   │  the day, the clock, the session's menu
├──────────────────────────────┤
│ Barbell Back Squat        ⓘ  │  ⓘ: how to — cue, instructions, video
│ ○ ○ ● ◌ ◌ ◌ ◌                │  warm-ups, done, NEXT, to do — one mark per set
│                              │
│    102.5 kg    ×    5        │  the next set, as big as the screen allows
│   −  2.5  +       −  1  +    │  steppers; a tap on a number types it
│                              │
│ last time 5 × 105 kg         │  one line, quiet
│ ┌──────────────────────────┐ │
│ │        Log set 3         │ │  one button, under the thumb
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ Up next                      │
│ Romanian Deadlift   3 × 8    │  the rest of the day, one line each,
│ Leg Press           3 × 12   │  tap to jump; supersets drawn as a pair
│ A Face Pull / Lateral Raise  │
└──────────────────────────────┘
```

- **Logging moves the focus**: the set is marked done, the next one comes up, rest starts.
- **Rest is the screen between sets**: a countdown band across the top, large, with +30 s and Skip;
  it does not hide the next set.
- **Effort after, not before**: once a set is logged, its row offers reserve as one optional tap,
  for the exercises that have reps.
- **Finish is in the session's menu**, asked twice, and offered prominently only once the day's sets
  are done.
- **While a session is in progress the app is in it**: the tab bar gives way to the session's own
  header; leaving is one explicit step.

### Today: what is next

The next day of the plan in use, one tap to start; a session in progress as the whole first screen
with Resume; history grouped by week, each session its exercises and how they went, a personal
best marked.

### The plan: an outline you edit in place

The plan's page is its outline — days, and each exercise as one line ("Squat · 5 × 5 · 100 kg ·
+2.5 kg a session"). Tapping a line opens that exercise's settings in a sheet (on desktop, a panel
beside the outline); changes are kept as they are made. Exercises reorder within a day and move
between days. No mode, no separate editor screen, no Save to leave.

### Finding exercises: by muscle and by use

Search with muscle and equipment filters, recently used first in the picker, each row its main
muscles and a thumbnail when it has one; a picker that adds several at once and stays open.

### Desktop as a layout, not a stretched phone

Two panes where reading side by side helps: plans (outline + the exercise being edited), exercises
(list + detail), Today (the next session + the week). The session itself stays a single focused
column — it is done on a phone.

## Supporting changes the API would need

Proposed, each to be decided:

1. **What is next.** The plan in use and its next day, for Today — computed server-side from the
   latest planned session (a read model, as `SessionPlan` is), not joined by the screen.
2. **Saving a plan as it is edited.** Today a plan is saved whole (`PUT /workouts/:id/plan`) after
   `planIssues` is clear. Editing in place needs either a debounced whole-plan save that tolerates a
   draft with issues, or entry-level writes. A draft that the schema would refuse cannot be stored as
   the plan.
3. **The review over HTTP** — `TrainingReview` as a contract schema, for a progress screen (and the
   coach's, #23).
4. **A session's summary** — duration, sets and the personal bests it set, for Today's history and
   the end of a session.
5. **Reserve only where it means something** — a contract rule (`asksReserve(tracking)`), not a
   screen's.

## Visual direction (proposal)

The current look — a system font, one blue, rounded grey cards — is a default rather than a choice.
What the subject offers instead is the gym's own vernacular: **calibrated plates** — red 25, blue 20,
yellow 15, green 10, white 5 — the one colour code every lifter already reads.

- **Colour carries state, from the plates.** A rubber-floor charcoal ground, chalk-white type, and
  the plate colours as meaning rather than decoration: the next set, rest, a personal best, a warm-up
  each one of them, consistently, and nothing coloured that does not mean something.
- **Numbers are the hero.** Weight and reps set large in a condensed grotesque with tabular figures —
  the language of a gym's clock and a plate's stamped numerals — and a plain grotesque for the rest.
  One family in two widths keeps the two clearly distinct.
- **Fewer boxes.** Hierarchy from type size and space instead of a card around everything; a card
  only where something is a unit you act on.
- **Built for distance and one hand**: targets of at least 56px where a set is logged, the primary
  action in the bottom third, contrast that holds in a dim room.

These belong in `src/ui/tokens.ts` and the primitives; no screen names a colour.

## Decisions to make

The frontier, in the order they unblock the rest:

1. Is the session a focused, one-exercise-at-a-time screen, or a list with the current exercise
   expanded?
2. Does a session in progress take over the app (no tab bar), or sit inside it?
3. Is reserve asked after a set, and only for exercises with reps?
4. Does the plan become an outline edited in place, with changes kept as made — and if so, how are
   draft plans with issues stored (question 2 above)?
5. Does Today predict the next day, and from what — the plan in use, chosen how?
6. Does the review get an HTTP route and a progress screen now, or with #23?
7. The visual direction: the plate-colour system and condensed numerals, or another?
8. Desktop: which screens get two panes?
