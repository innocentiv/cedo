# Frontend

Expo SDK 58 / React Native 0.88 / React 19.3, with `expo-router`. Web-mobile-first, plus a tablet
two-pane layout. It depends on **`@cedo/contract` and nothing else** from this repo.

## The thinness rule

This is the rule the whole frontend is organised around, and the reason the test suite can be as
small as it is.

> A screen **may**: call the hooks in `src/api/queries.ts`, `src/api/session-queries.ts`,
> `src/api/athlete-queries.ts` and `src/api/equipment-queries.ts` (never
> `api.*` or `fetch` directly),
> render UI primitives, hold form state, and call pure helpers from `@cedo/contract`
> (`formatEffort`, `formatWeight`, `formatPrescription`, `workingSetsDone`, `planInputFrom`).
>
> A screen **may not**: perform unit arithmetic, sum muscle loads, decide progressions, hand-format
> measurements, or branch on domain rules. If a screen needs a rule, the rule belongs in the
> contract, where it is unit-tested with no DOM.
>
> No raw `<View>`, `<Text>` or `StyleSheet` in a screen file. No literal colour or pixel value
> anywhere outside `src/ui/tokens.ts`.

Every behaviour is proven on the backend (`docs/10-testing.md`). If a screen grows logic worth
testing, that is the signal it belongs somewhere else.

A screen that would join several reads to decide one thing asks for the answer instead. The live
session screen joined the session, its workout and its progression, and took a plan it failed to
FETCH for one out of reach — offering the logger of a session without a plan, whose next set went
into the wrong series. `GET /sessions/:id` now answers with the plan as the reader can reach it
(`SessionPlan`), each entry's done count included, and the screen renders that.

## The dependency boundary

`apps/app` must never import from `apps/api` — not even a type. This is enforced, not merely
agreed: `apps/app/.oxlintrc.json` sets `no-restricted-imports` on `@cedo/api` and on any relative
path that climbs into it, so a violation fails `bun run lint`.

The rule holds for test helpers too. The end-to-end harness needs a running API, and it starts one
as a **subprocess** rather than importing `createApp`. The two halves meet over HTTP exactly as they
do in production. See `docs/01-architecture.md`.

## Layout

```
app/_layout.tsx              ErrorBoundary > SafeAreaProvider > QueryClient > AuthProvider > Slot
app/index.tsx                the only cold-start redirect
app/(auth)/_layout.tsx       bounces a signed-in visitor out
app/(auth)/login.tsx  register.tsx
app/(app)/_layout.tsx        the signed-in shell: bottom bar on phone, sidebar on tablet

app/(app)/today/            index · session/[id]        the live logging screen
app/(app)/workouts/         index · [id]/index · [id]/edit
app/(app)/exercises/        index · new · [id]/index · [id]/edit
app/(app)/athletes/         index · [id]/index · [id]/sessions/[session] · [id]/exercises/[exercise]
app/(app)/settings/         index · groups/index · groups/[id]/index · tokens · connect

src/ui/                      the entire visual vocabulary
src/api/                     transport.ts, client.ts, http.ts, errors.ts, query-client.ts, queries.ts,
                             session-queries.ts (a session's writes and its offline queue),
                             athlete-queries.ts (a coach's reads of an athlete's training),
                             equipment-queries.ts (what you, or an athlete, train with),
                             retry.ts and pending.ts (+ their unit tests)
src/auth/                    session.ts (+ its unit test), auth-provider.tsx, token-storage.ts
src/pwa/                     shell-cache.ts (+ its unit test), service-worker.ts, register.ts
src/lib/                     use-submit.ts, plan-draft.ts and plan-sync.ts (+ its unit test), forms,
                             pickers, group-placement.tsx, duplicate-into-my-group.tsx, and each
                             screen's parts: the workout's, Today's, Progress's, a workout's
                             outline, an exercise's (exercise-detail.tsx, exercise-about.tsx,
                             exercise-media.tsx), the desktop sidebar's (sidebar.tsx), an
                             athlete's, read by their coach (athlete.tsx)
e2e/                         harness.ts, server.ts, shot.ts, routes.e2e.ts, journeys.e2e.ts,
                             harness.e2e.ts (the harness's own tests), journeys.test.ts (the rules
                             journeys obey), screens/ (one driver per screen; test ids live here)
```

Each tab directory has its own `_layout.tsx` holding a `Stack`, so pushing a detail screen keeps the
tab bar and the back gesture. A route that is **not** a `TabTrigger` in `app/(app)/_layout.tsx` is
unreachable under the headless tabs navigator — which is why live logging sits under `today/` rather
than at a top-level `log/`.

### One navigator, two arrangements

The shell uses the headless `Tabs` from `expo-router/ui`, so the chrome is ours: the same four
triggers render as a bottom bar under 768px and a left sidebar above it. Swapping between two
different navigators on a width change would remount every screen and throw away scroll position and
half-typed input mid-resize.

Two constraints found by building it:

- **`TabList` must be a DIRECT child of `Tabs`.** The navigator discovers its routes by walking its
  own children for one. A wrapper `View` in between produces "Couldn't find any screens for the
  navigator" — so `Tabs` is itself the flex container.
- **`TabList` renders a row by default**, so the sidebar states `flexDirection: 'column'`
  explicitly. Without it the items laid out side by side and clipped at 220px. The screenshot
  caught this; a passing test did not.

## The UI vocabulary

`src/ui/index.ts` is the complete list a screen may import:

| Primitive | For |
| --- | --- |
| `Screen` | the outermost element of every route: safe area, background, padding, optional footer |
| `Stack` | every layout. There is no other container |
| `Text` | all text. Variants `title` / `heading` / `body` / `label` / `caption` / `mono` |
| `Button`, `NavButton` | actions, and actions that navigate — in the app, or out of it to an absolute URL |
| `NavItem` | one tab of the shell's tab bar or sidebar — used only by `app/(app)/_layout.tsx` |
| `ConfirmButton` | every action that cannot be taken back — delete, revoke, remove, leave — and every transfer to another group, which others feel at once. Asked twice, in the app's own UI, never a browser dialog; a refusal shows beside it. Removing a set from a session in progress is not one: it is logged again in a tap |
| `PinButton` | pinning what you can see, for its list's "Pinned" filter: a star, filled in the accent while pinned, small on the line saying which group it is in |
| `ProgressTrend` | an exercise's progress: a bar per session from the contract's `trendOf` — the estimated max of a weight lift, the top set otherwise — and the server's stall as a badge |
| `Field`, `Input`, `NumberInput`, `DimensionInput`, `CompactField` | forms. `NumberInput` is a count; a measured quantity is a `DimensionInput`. `Input`'s `look` sets a name edited where it reads — a workout's title, a day's heading — with no box |
| `Card`, `ListRow` | the one row shape every list uses |
| `Chips` | one choice from a short flat set, all in view — tracking mode, progression kind |
| `FilterRow`, `FilterSheet`, `FilterTrigger` | how a list is narrowed (#52): every filter one trigger — a glyph for what it narrows, its value cut short to fit, a ▾ — a segment of one bar as wide as the list, each as wide as what it says and a share of the rest (`segmented`, the look reps in reserve shares), filled while it narrows the list, with Clear filters — small words under the bar's end, no outline — putting them all back, so the bar keeps its width as a filter is set. `FilterSheet` is a filter whole: its trigger, and the sheet of its own it opens, closed by choosing |
| `OptionRow`, `OptionGrid`, `OptionSection` | a filter's sheet: a few choices one per line, each with a word if it needs one (`OptionRow`); many in cells of one width, so many to a line (`OptionGrid`); a headed part of either (`OptionSection`) |
| `Chip` | one choice of a set, on or off — what `Chips`, the muscle and equipment pickers and the equipment checklist are built of |
| `Empty`, `Spinner`, `ErrorNotice`, `FormError` | the four states that are not "content" |
| `Loaded` | failed / not-yet / here, around any query. A screen never writes that ternary |
| `ErrorBoundary` | the last line of defence |
| `ExerciseRow`, `MuscleFilter` | an exercise in a list — picture, name, main muscles — and narrowing a list to one muscle, chosen from a grid by region |
| `VideoPlayer` | an exercise's video, played in place once tapped, never fetched before |
| `SidebarName`, `SidebarAccount` | a desktop sidebar's head — the product's name — and foot — who is signed in |
| `Meter` | how much against the most — a muscle's sets — chalk, or red where it declined |
| `RemoveButton` | removing a day or an entry from a plan edited in place: the bin, asked twice |
| `Sheet` | something looked at without leaving where you are — a session's menu, how to do an exercise. From the bottom on a phone, in the middle on a desktop |
| `Icon`, `IconButton` | a secondary action as a glyph alone — back, menu, close, undo, how to — named aloud by its label |
| `Screen` `onBack` | a way back beside the title, on a screen reached from another with no other way out |
| `Screen` `ownHeading` | a heading of the screen's own in place of its title and Back — a workout's name, edited where it is read — laid out where a title is: pinned over both columns on a desktop |
| `Screen` `columns` | a screen whose whole body is two columns — `{ main, side, narrow? }`, or `{ main, pane, narrow?, chosen? }`: on a desktop side by side under the title, each its own scroll, so a pane stays beside whatever the other is scrolled to (#50); on a phone the main then the side in one scroll, but never a pane — a phone opens what it holds elsewhere, a screen of its own or a sheet, so a screen does not branch on the layout to leave it out. Either `null`: the main alone. `chosen` is what the pane shows when it is one thing chosen — another opens at the pane's top. `children` still render: the sheets the screen opens |
| `Columns` | two columns that are a part of a page, not the whole of it — a review, with more above and below it: one column on a phone, side by side on a desktop, both in the page's one scroll. The side the narrow one, or the main when it is a list leading to the side. A screen whose body is the two columns uses `Screen` `columns` instead |
| `Thumbnail` | a picture of a movement: a video's thumbnail, an uploaded image |
| `color`, `space`, `radius`, `type`, `font`, `CONTENT_MAX_WIDTH`, `WIDE_CONTENT_MAX_WIDTH`, `CONTROL_HEIGHT`, `LOG_CONTROL_HEIGHT`, `ROW_HEIGHT`, `ICON_SIZE` | the only source of visual values |
| `useAppFonts()` | the bundled faces `font` names, loaded beside the app at its root — never waited for |
| `useLayout()`, `TABLET_MIN_WIDTH` | the only layout branch: `'phone' | 'tablet'`, and where it switches |

Composites are here rather than in a screen, because each is used from more than one place or
would otherwise be copied: `MusclePicker`, `EquipmentPicker` (what an exercise needs, by group,
or nothing — none chosen is undescribed, #33), `EntryEditor` (one plan entry's fields, opened from its
line in a workout's outline, #26), and the
workout's (#24) — `FocusLogger` (the exercise in focus: its `SetMarks`, the next set's `Stepper`s,
one Log button, and the reserve asked before it), `LastSet` (the set just logged: a best, its
reserve as said, Undo), `RestBand`, `UpNext`
and `AddRow`,
`SessionHeader` and `ReturnBar`; and Today's (#25) — `WeekStrip`, a week's days as the contract's
`weekStrip` gives them. They are still presentational — the rules they render (loads
summing to 100, which inputs a tracking mode implies, what a progression rule contains, which set
is next, where the focus goes, whose rest runs, what a set is called) all live in `@cedo/contract`:
`session-flow.ts` and `set-marks.ts` for the workout, and `workout-view.ts` for what its screen
shows of them — the focus, the set above it, "+ set", the rows marked — from the sets and what the
athlete chose. An unavailable exercise has no mode, so no
inputs: the workout shows what it prescribed and that nothing more can be logged against it, and
a workout's outline gives it a line that says so — what it prescribes, and the bin, which is the
only way the plan saves again.

Smaller parts serve those composites and no screen, so they are not in the list above:
`ReserveChips` — RPE asked as reps in reserve, holding an RPE while the contract converts
(`rpe.ts`) — used by `LastSet` and by `PrescriptionFields`: what an entry asks of the athlete,
its targets, reserve, rest and cue. The rest band's clock is `useRestClock`
(`src/lib/rest-clock.ts`); it and the session's clock read `useNow`
(`src/lib/use-now.ts`), a clock of its own that ticks once a second only while it must — so the
band re-renders, not the day. The tone at the end of a rest is `src/lib/chime.ts`, made by the
browser, nothing bundled — three beeps, played through iOS's silent switch where Safari lets a page
say its sound is a short alert (`navigator.audioSession`, `transient`: it lowers the athlete's
music for a moment, where `playback` would stop it), and a buzz where `navigator.vibrate` exists.

Sets logged without a signal (#9) count as done on the workout — the next set comes up, rest
starts — through `withPending` (`src/api/pending.ts`): app-owned state with no React in it, so
unit-tested beside it, like `retry.ts`. Each is dated after the latest stored set, so a server
clock ahead of the device cannot send the focus back to a set already done.

A composite that reads through a query hook is not presentational, so it lives in `src/lib/`
instead: the exercise picker, and `GroupPlacement` — one quiet line under an exercise's or a
plan's name, on both detail screens: which group it is in, then its pin and Transfer to group as
glyphs (★, ⇄), both rarely used, the transfer's choice opening under the line. Where it may go is the server's `canTransferInto`, not a rule
of its own; a plan the target group could not read is refused by the server, which says why. And
`DuplicateIntoMyGroup`, which a reader is offered on both detail screens in place of Edit. It makes
a copy in their own group and opens the copy's editor. A refusal is the server's, shown beside the
button.

Editing a plan follows the same split. How sets resize within an entry's total, what a target change
applies to, what a new entry prescribes, and whether another day or exercise fits are
`plan-editing.ts` in the contract, with its tests; the limits themselves are declared once beside
the schema in `workout.ts`, which enforces them. The editor only wires these to controls. It also
reads `planIssues(draft, visible)` — the schema's own verdict, located by day and exercise, and
first every entry whose exercise it cannot see, which the server would refuse — as the draft is
edited, shows it above Save, and disables Save while there is one. The editor prevents what it
models; that line catches what it does not, before the request rather than as a 422. The editor
once clamped warm-ups and working sets to 20 each while the schema allowed 20 in total, which is
the drift this split exists to stop.

**If you need something not on this list, add it here rather than inline in a screen.** The list
being complete is what stops the next session re-inventing `Loaded` under a different name.

Dark only, deliberately: this is used in a gym, usually in poor light. A light theme is a second
token map plus a `useColorScheme()` lookup, and no screen changes.

A measured quantity — a weight, reps, a duration, a distance — is a `DimensionInput`: it takes and
emits **base units**, and everything about how it is typed comes from `DIMENSION_FIELDS` in
`@cedo/contract` — the unit label (`+kg` on a bodyweight movement), whether it takes decimals, the
conversion, and the parse. Which fields a set shows, and in what order, is `fieldsOf(tracking)`.
No screen converts a unit or picks a label: the logger, the plan editor and the progression field
each used to, and disagreed. `NumberInput` is for plain counts — sets, a rep range, a percentage.

On a bodyweight movement the weight field also has an **Added / Assisted** toggle (#19). Assistance,
such as a band or an assisted machine, is negative added weight. A phone's number pad has no minus
key, so the number typed is the size and the toggle is the sign. A stored value carries its own
sign, so an assisted target opens assisted. A field emptied on the way to retyping keeps the last
sign seen. Those rules are the contract's `assistance`, tested there; the input only wires them.

A logged set is held as an `Effort` and read and written through each field's `key`; a prescribed
set's target through its `targetKey`. A screen therefore names no measurement field itself. The
plan editor patches only the target that changed — never a whole `Effort` mapped back onto the
set — because its patch is applied to every working set, and a whole one would overwrite the other
sets' targets.

Both share one field, `TypedNumber`. A value is `number | null`, where null means empty — an empty
numeric field is not zero, and zero reps is a meaningful log. While focused the field shows the text
being typed rather than the number it parses to; the contract's parse returns both, and accepts a
comma as the decimal separator. Both are load-bearing: the first version rendered from the number,
so a half-typed "62." collapsed to 62 and the next key logged 625 kg.

What the field shows, and when its text gives way to the parent's value, is the contract's
`editField` — a pure function of the field's state and one event (`type`, `value`, `settled`,
`blur`), tested key by key in `typing.test.ts`. `TypedNumber` holds that state and forwards the
input's events to it, nothing more. The e2e journeys that type key by key stay: they prove the
wiring — that React delivers those events in the order the module assumes — because `fill` inserts
a whole string in one event and never passes through the half-typed state.

A duration is typed on a number pad, which has no `:` — so, as on a timer, the last two digits are
seconds and the two before them minutes (`CLOCK` in the contract): `130` is 1:30, `2500` is 25:00,
and a bare `90` is still 90 seconds. The field regroups its digits as they grow ("13" becomes "1:30")
and shows them as typed until it is left, so `190` reads "1:90" while focused and "2:30" after. A
duration READS as the same clock everywhere (`formatDuration`), so what you read is what you type.

## The athlete-first redesign (#23)

Decided in October 2026 from `docs/ux/2026-10-ui-review.md`, and built in slices, each its own
issue under #23. What each screen IS, so a slice builds toward one picture.

### The workout screen

**One thing at a time.** The current exercise fills the screen: a mark per set — warm-up, done,
next, to do — the next set's numbers large, with − / + steppers whose steps are the contract's
(2.5 kg or 5 lb, one rep, five seconds, a hundred metres) and a tap on a number to type it, and
one Log button under the thumb. A weight whose load the athlete's equipment knows (#36, `useLoads`,
the contract's `loadOf`) steps between the weights they have instead — 20, 22, 24 on 2 kg
dumbbells, from 21 typed to 22 or 20 — stopping at their lightest and heaviest; the plan's own
targets (warm-ups) are asked as they can be loaded (`setsOf`), the session's as the server sends
them, and the target says when it stopped at "your heaviest" or "your lightest". Typing is never
refused. A new weight rule in the plan editor adds one step of that equipment. "Up next" is the rest of the day, an entry to a line, a superset
drawn as one item; tapping one makes it current, and tapping a logged set re-opens it.

- **A choice holds until this device logs or undoes a set**, or goes to pick an exercise — not
  until the latest set changes: a set logged without a signal is known by its key until the server
  has it, then by the server's id, and a choice held to it was lost as it landed. What is picked is
  chosen in turn, so it takes the focus. Once a set is logged, a swap keeps the focus while a set
  of it is the one logged last, and a set of the day gives the day its focus back. The choices are
  the screen's own (`useWorkout`); what they put in focus is the contract's `workoutView`.
- **Logging moves the focus** to the entry's next set, then to the next entry in day order with
  sets left. Entries of a superset alternate, and rest starts after the pair.
- **Rest starts on its own** when a set is logged: a countdown band with +30 s and × to skip it,
  above the set it follows; at zero the band changes colour, beeps three times and buzzes where the
  device can, if the app is open. The server keeps the rest's end (#38; +30 s and skip are writes,
  queued behind the sets), and the countdown takes it when it is later (`restCounted`), so a reload
  or another device counts the same rest. Being told with the app closed waits for the native app
  (#39): Web Push never reached an iPhone.
- **Reserve is asked before Log** (#37), as one optional row in the logger, under the numbers, and
  only for a working set of an exercise measured in reps — which those are is the contract's, not
  the screen's. Whole reps, none to five, one row of segments; tapping the chosen one again takes it
  back. Never pre-filled, not even from the plan's RPE, and empty for each set. Once logged, the set
  says its reserve and asks nothing more: Undo, or correcting it from the summary (#31), is how a
  mistake is fixed.
- **"+ set"** logs one beyond the prescription; **Add exercise** logs one with no entry, as a swap
  when a machine is taken — today's ad-hoc logging, which leaves the entry's progression alone.
- **ⓘ** opens how to do it — cue, instructions, muscles, the video — without leaving the session.
- **A session in progress takes over the app**: its own header — back, the day, the time since it
  started, the menu, on one line — in place of the tab bar. Back leaves it in progress, and a bar on
  every screen returns to it; only Finish ends it. Notes and Finish are in the menu, Finish asked
  twice, and notes kept as the menu closes — no Save; once every prescribed set is logged, Finish takes the Log
  button's place, and finishing shows the session's summary. A personal best is marked on the set as
  it is logged.
- **A session without a plan** opens on the picker; each exercise added becomes the focus.
- **Logging without a signal is unchanged** (below): the same queue, the same marks on a set waiting.

### Today

What to do next: the **next day** of the **current workout** (`GLOSSARY.md`) and Start, one tap. A
session in progress is the whole first screen. History is grouped by week, each session its
duration, sets and personal bests; tapping one opens its summary, its sets by exercise, and its
notes, which stay editable. The screen reads `GET /today` — the session in progress, the current
workout and its next day, the week — rather than joining reads to decide them.

As built (#25), on a phone top to bottom, on a desktop in two columns (`Screen` `columns`):

- **What to do now** — one card. The next day: its workout, its name large, its exercises, and
  Start {day}, yellow; Another day opens the workout. With a session in progress, the card is that
  session and Resume instead, and the return bar is not shown on Today: the card says it, larger.
  With no current workout, Choose a workout. Log without a plan sits under the card, quiet.
- **The week** — "3 sessions this week" over a strip of seven days, Monday first (`WeekStrip`):
  a day trained filled, today ringed in chalk. No plate colour: a day trained is a fact, not a
  state to act on.
- **History** — by week ("This week", "Last week", "Week of 6 Oct"), each row its day, `Thu 23 Oct ·
  52 min · 18 sets`, and its personal bests in green as the gym says them, `PB` or `3 PBs`. Twenty
  at a time; Show older sessions asks for the next page.
- **A finished session** — its date, time, working sets and bests; its notes written in place, kept
  as the field is left; its sets by exercise, a best marked `PB`. The menu is gone once finished:
  what it held is on the page, or done.
- **A past mistake fixed** (#31) — a set of a finished session tapped opens a `Sheet`
  (`fix-set.tsx`): its numbers on the logger's own `Stepper`s, how hard it was, Working set or
  Warm-up, Save — and Remove set, asked twice. Never its exercise: that set is removed and logged
  again. Delete session is last, under the sets, asked twice, and goes back to where it was opened
  from. A set of an exercise out of reach shows no measures, so offers only how hard and which
  kind. Bests, history and the next targets follow, being judged on read. A coach's view of the
  same session has none of it (#30).

The app says where its week starts (`startOfWeek`, local Monday); the server cannot know the
reader's time zone. Weeks and lines are the contract's `week.ts`.

### Editing a workout

The workout's page is its outline: days, and each entry one line — "Barbell Back Squat · 5 × 5 ·
100 kg · +2.5 kg a session". Tapping a line opens the entry's settings in a sheet, or a pane beside
the outline on a wide screen. Each change is saved as it is made, and there is no edit mode: see
`docs/adr/0022-plans-edited-in-place.md`. Days and entries reorder, entries move between days, and a
workout is renamed and its notes edited where they are shown.

As built (#26):

- **The head** — back, the name set as the title it is and edited there (`WorkoutTitle`, the
  screen's `ownHeading`), the notes under it, each kept as its field is left; then one line on
  the plan: Saved, Saving…, or Not saved and why.
- **The outline** — each day its name (edited where it reads, kept as the field is left and put
  back if left empty — no day is nameless), Start, ↑ ↓ and the bin; each entry one line, `5 sets · 5 × 100 kg · Linear, +2.5 kg`, a superset's letter before its name; Add exercise
  at the foot of a day, Add day at the foot of the plan. An unavailable exercise's line says so,
  with the bin.
- **An entry's settings** — its fields (`EntryEditor`), then where it is in the plan: chips to move
  it to another day, ↑ ↓ within its day, the bin. In a sheet on a phone; on a desktop, a pane
  beside the outline (`Screen` `columns`), which waits with a line until an entry is chosen. Kept
  open by the entry's key, so it follows the entry as it moves and closes once it is gone. The
  outline and the pane scroll each on their own (#50): an entry on the fifth day opens beside it,
  not at the top of a page scrolled past them, and another chosen opens at the pane's top. Back
  and the name are pinned across both, as any screen's title is — in the outline's column they
  were cut to its width, and scrolled away; the notes and the plan's line scroll with the outline,
  so a long note takes no height from the pane.
- **Removing** a day or an entry is asked twice (`RemoveButton`, `ConfirmButton`'s rule as a
  glyph): it is saved at once, its id with it, and cannot be taken back. A plan keeps one day
  (`canRemoveDay`).
- **Saving** is `src/lib/plan-sync.ts`, unit-tested: a change is sent at once if the schema
  accepts the plan, one save at a time — a change made meanwhile goes when the last answer comes,
  as the plan then stands — each with the version it was made from. The ids the server gives what
  is new are learned from its answer by position and carried by key, so the next save keeps them.
  A refusal puts the plan back as last saved and says why — and with it any change made while the
  refused one was on its way, which was built on it; a 409 reads the plan again and says it changed
  elsewhere, and a failed read is a refusal, so the page is never left Saving. A plan read
  meanwhile is taken only when it is newer and nothing is unsaved; a name and notes read again
  with other values start their fields from those.
- Under the name, one quiet line (`GroupPlacement`): which group it is in, a star pinning it, ⇄
  transferring it — rarely used, so glyphs, not buttons of their own. Delete sits under the
  outline. A reader sees the same outline with nothing to tap but Start and the star, and Copy into
  my group under it.
- `/workouts/:id/edit` redirects to the workout's page, for old links.

### Finding exercises

Search, and a muscle filter grouped by region; each row its main muscles, and the video's thumbnail
when there is one. The picker leads with what you have logged lately, marks what the day already
has, and adds several at once. A new exercise starts from its muscles, their loads an even split
that totals 100, to adjust.

As built (#27):

- **A row** (`ExerciseRow`) is its picture — its video's thumbnail (`videoThumbnailOf`, never an
  uploaded image), or a quiet slot with its initial holding the place, so every name starts on one
  edge — its name, and its three most loaded muscles (`mainMuscles`). A tag says anything else
  short: Pinned, In this day.
- **The filters** (#52) are the same three in the library and the picker (`ExerciseFilters`): whose
  — All, Mine, Library, Pinned, then each shared group of yours by name (`ScopePicker`, the
  contract's scope with its group) — what it works (`MuscleFilter`: Muscles until one is chosen
  from Upper body, Core and Lower body, `MUSCLE_REGION_LABELS`, in a grid two to a line on a phone
  and three on a desktop), and what it needs (`EquipmentFilter`: My Equipment or Any Equipment).
  The Workouts tab has the first. Each is a `FilterTrigger`, a segment of one bar as wide as the
  list — the look of reps in reserve — opening a sheet laid out for what it holds; Clear filters, small
  under the bar, clears them, never the search — not an × beside it, which narrowed the bar as a
  filter was set. The defaults are short so the three fit a phone's width:
  as pills on a line scrolling sideways, the third was cut at the screen's edge.
- **A list longer than a page** — the library, the picker, the Workouts tab, History — ends in a
  button asking for the next (`ShowMore`, `api/paged.ts`), never a dead end.
- **The picker** leads with the five exercises logged most lately (`GET /exercises/recent`: the
  person's own logs, latest first, of exercises they can still see), then All exercises; searched or
  filtered, only the matches. A tap chooses, with a check; Add N adds them together, in the order
  chosen, the first of them opened or put in focus — they are done in that order. What the day or the
  session already has is tagged, and still pickable — a second squat is a real plan.
- **A new exercise's muscles** are split evenly as each is chosen or dropped, so the form is valid
  the moment one is chosen; once someone sets the loads, they are theirs — a muscle chosen joins at
  nothing — so editing an exercise never undoes what was saved (`withMuscleToggled`).
- **The video plays where it is shown** (`VideoPlayer`), on the exercise's page and in How to: its
  thumbnail with a play mark, and the provider's player in its place once tapped — a link with no
  thumbnail, as Vimeo's, a plain panel to tap. The player is not loaded until then; the thumbnail
  is, from the provider's image host (YouTube's), wherever a row or a page shows it. Off the web, or
  for a link no player shows, Watch the video opens it.

### Progress, and the tabs

**Today · Workouts · Exercises · Progress · Settings** — and Athletes before Settings, for a coach
(below). Progress is the training review — sessions a
week and the streak, days skipped, work per muscle against the period before, and what has stalled,
is falling or is drifting — the same read the AI gets, over HTTP.

As built (#28): `GET /review?weeks=` answers `TrainingReview`, now a contract schema the route
and `training_review` both say; the tab looks back 4, 8 or 12 weeks.

- **How consistently** — a week, the streak, the longest gap, as numbers; how many sessions, and
  when the last was.
- **What needs attention** — Stalled, Falling, Harder each time, each a line of why it matters and
  a row per exercise (`stallLine`, `fallingLine`, `driftLine`: drift said as reserve, as it is
  asked) — or "Nothing has stalled or slipped"; with nothing logged, no verdict at all.
- **Days trained** — every planned day of the workouts trained in the period, in plan order, and
  how many times — a day never trained says Not trained, in red: the day skipped is the one most
  worth seeing.
- **Work per muscle** — named, in sets by its share of each exercise, against the period before,
  a bar against the most worked (`Meter`, `muscleRows`); a declined muscle in red wherever it is
  listed, and those beyond the most worked under their own heading.
- **Bodyweight** (#42, `BodyweightCard`) — under the review, over the same weeks
  (`GET /weigh-ins?weeks=`): the latest weigh-in and its change since the latest before the period
  (`bodyweightTrend`, `trendParts`), today's typed in the reader's unit and dated by the device's
  calendar (`calendarDayOf`), and the period's weigh-ins and the latest before it, a week's until all
  are asked for. Then the
  notes (#41). The year of birth is said in Settings.
- The review is a read the cache catches up on behind a set, never awaits (`lagging` in `READS`):
  it costs a whole aggregation, and nothing the next set does depends on it.

### Desktop

Two panes where reading side by side helps: a workout's outline beside the entry being edited, the
exercise list beside the exercise, Today's next session and week beside the history — and the
session: what was just done and the exercise in focus, beside the day and its sets (`Screen`
`columns`). One column 700 points wide made the Log button the loudest thing on a desk, which it is
not there. A session left open is the same yellow band as on a phone, at the foot of the sidebar —
a line with a yellow dot was tried and read as too little; a sheet opens in the middle of the
screen, not from its bottom edge. The sidebar carries the product's name and the account.

**Each column its own scroll (#50).** The page does not scroll on a desktop screen of two columns:
the title stays above them, the footer below, and each column scrolls between — so a pane stays
beside whatever the list or the outline is scrolled to. In one page scroll the pane sat at the top
of the page: choose an entry on the fifth day of a plan and its settings opened several screens
above, out of sight. `position: sticky` was the other way: web-only, outside React Native's types,
and its height worked out by hand around the title and the footer; two scrolls take theirs from the
layout, and hold on native. The wheel scrolls the column under the pointer, and each keeps its
scrollbar — on Windows mid-page, but the only cue that a pane scrolls on its own. A screen asks for
this with `Screen` `columns`, never with a `Columns` and a scroll switched off: one switch, so the
two cannot disagree. `Columns` that are a part of a page — a review, the period above it and
bodyweight below on Progress, and inside an athlete's pane — stay in the page's one scroll. A
window dragged across the tablet width loses its scroll position, as it changes layout.

As built (#29): the exercise chosen from the library opens in a pane beside the list
(`ExerciseDetailView`, a pane on a desktop — its title and Edit at its head), the list kept; the
sidebar names the product at its head, and at its foot who is signed in — a tap to Settings —
above the band of a session left open. On a phone it opens over the list in a sheet
(`ExerciseSheet`), put away with its × or a tap around it, as an entry's settings are over a plan:
it was a screen of its own, which an installed app gave no way back from. Its editor, pushed from
inside the sheet, is not covered by it (`useFocused`); the sheet is there again on coming back. Its
address, `/exercises/:id`, opens the library with it open, either way.

### Your equipment

**Settings → Equipment** (#34, `EquipmentForm`): what you have to train with, a checklist by group,
with shortcuts that tick several at once (a cable column, an adjustable bench, a full gym). An item
that holds the load, ticked, opens its weights — from, step, to, in your unit — starting where the
contract says (`defaultWeights`: a bar from the bar), and a second pulley from the first's. The
checklist edits a draft whose weights may be half-typed; Save refuses weights half typed
(`unfinishedWeights`), saves weights left wholly empty as not known (`equipmentInputFrom`), and
replaces the whole list. The Settings row says whether it is described yet (`equipmentCount`).

**Doable** (#35): until you have said what you have, the library and the picker offer everything
and the library asks you to say (`EquipmentPrompt`); after, they offer what you can do, with a
switch to everything (`useDoableFilter`, `EquipmentFilter`) — the filter is the server's. An exercise you cannot do
says "Missing equipment" on its row, in a plan's outline, and on its page; a plan keeps it.

### The coach's view

A coach is an editor of a group an athlete shares their training with (ADR-0021), and reads it —
never writes it. As built (#30):

- **An Athletes tab, offered only to a coach** — someone with at least one athlete sharing with
  them (`GET /athletes`). Its trigger stays in the navigator unshown otherwise: the headless tabs
  know a route only by its trigger. Reached by its address with nobody sharing, it says so.
- **An athlete's page** (`AthleteView`): the session they are in now, if they are — a row that opens
  its sets so far — then their Progress, the same `Review` and periods as your own tab
  (`GET /athletes/:id/review`) and their bodyweight over the same weeks (#42, `BodyweightCard`) —
  their age, from the review, beside their name —
  then what they have to train with (#34, `AthleteEquipmentCard`), then their notes (#41), then
  their history by week (`PagedHistory`, as Today's). Nothing on it changes their training.
- **Their notes and weigh-ins are what a coach writes** (#41, #42, ADR-0021 amended): `Notes` and
  `BodyweightCard`, the same cards as on your own Progress, under `/athletes/:id/…` in place of
  your own routes. Each note offers Edit to its author, and each note and weigh-in Remove to its
  author or the athlete — the server says which (`canEdit`, `canDelete`); the card only shows it.
  A weigh-in names who took it only when that is neither the reader nor the athlete
  (`weighInRow`): a coach's, on the athlete's own Progress.
- **Read again on coming back, never polled.** They train on their own device, so nothing the coach
  does marks it stale: on regaining focus the page asks who shares again, and only then — while
  they still do — their reads (`useReadAthleteAgain`). A share ended is learnt first, so their reads
  are never asked again only to be refused; every read of theirs is asked only while they share, and
  the page says "Not shared with you" instead. A session of theirs is read each time it opens.
- **A session of theirs** opens read-only, under the name its row gave it (`openedSessionName`):
  what it came to and their notes, beside the sets by exercise. An exercise opens their history of
  it — trend and sessions — and only one the coach can see: one they cannot has no name, and no
  way in. Each screen past the list has a way back (`Screen` `onBack`): an installed app has no
  browser Back.
- **A plan out of the reader's sight is "Plan unavailable"**, never "Without a plan" (`sessionName`):
  the athlete's own plan, read by their coach; a group's, after leaving it.
- **On a desktop**, the athletes beside the one open, in the address (`/athletes?open=<id>`), as an
  exercise in the library — the list the narrow column here (`Screen` `columns`, `narrow: 'main'`),
  since each row opens a whole training beside it.
- **Their reads are of `athlete` in `READS`**: they write it, on their own device, so nothing the
  coach does awaits it — their own sets least of all. Renaming an exercise, or a group change,
  still refreshes it behind.

### The look

The gym's own vernacular, the colour code of calibrated plates — red, blue, yellow, green, white —
used **only for state, and one meaning each everywhere**:

| Plate | Means, and only means |
| --- | --- |
| yellow | act now — the next set, the action to take, the session waiting for you |
| blue | rest |
| green | a personal best |
| white | a warm-up |
| red | careful — something went wrong, or a change cannot be taken back |

Everything else is chalk on a charcoal ground — a selection too: a chosen chip, the tab you are on,
a set re-opened are chalk, never yellow, so nothing chosen is taken for the next thing to do. Weight and reps are set large in Barlow
Condensed with tabular figures, everything else in Barlow — bundled with the app, so a self-hosted
instance asks nothing of a third party and the installed app works offline. Fewer boxes: hierarchy
from type and space, a card only around something acted on as one. Where a set is logged, nothing
is smaller than 56px. Dark only, still.

**Space says what belongs together** (#24 review — "it is not clear which element is connected with
which"). Three distances, no others: the widest (`xxl`) between groups — what was just done, the
exercise in focus, the day, the session's sets; a middle one inside a group; the closest between a
label and what it labels. One left edge: every line of text on a screen starts on it, and a list
row's ground bleeds into the gutter rather than pushing its text in. A number shown large has its
unit after it on the same line, smaller and quieter — "102.5 kg" — and the line is level with the
− and + either side. (Centred under it was tried: the number read low, and apart from its unit.)

**A secondary action is a glyph** — back, the menu, close, undo, remove, how to, the arrow back to a
session — drawn in `icon.tsx`, a hand-drawn set on one grid, and always named aloud (`IconButton`'s
`label`). Undo is an arrow turning back, never a circle, which reads as reload; removing something
from what is being edited is a bin. What cannot be taken back — deleting a workout, revoking a
token, removing a member — keeps its words and is asked twice (`ConfirmButton`). Its touch area is a
full control, pulled past the content's edge so the glyph lines up with the text beside it. What
the screen is for keeps its words: Log set 2, Finish session, Add exercise. Every value is in `src/ui/tokens.ts`; the primitives are the
only thing that reads them.

## The API client

A hand-written typed `fetch` client, not Eden Treaty. See `docs/adr/0015-no-eden-treaty.md`.

Three layers, so the same route table serves more than the app. `transport.ts` sends one request and
parses its response — plain `fetch` and the contract. `client.ts` is `createApi(request)`, every route
the app calls, auth included. `http.ts` is the app's adapter: the base URL (`Platform`, env), the
signed-in credential, the 401 handler, and the app's `api`. The e2e harness is the second adapter: it
builds a client per user it signs up, from the test process, so fixtures are typed and parsed like
everything else rather than `fetch`es evaluated inside the page.

Every response is parsed with the **same contract schema** the API validated it against. On a
mismatch the client throws `ContractDriftError` with the exact JSON path. That is deliberately loud:
it lands in `console.error`, which fails the WebView run and hands the message to whoever is
iterating. Compile-time types say nothing about what a running server returns.

`useSubmit` is the one piece of shared screen mechanics: a busy flag, a message, and per-field errors
read from the contract's own `details` array. Anything that is not an `ApiError` — a drift, a dead
network — is re-thrown into the console rather than flattened into "something went wrong", because
hiding it would hide exactly what the client exists to catch.

### A weight is read in the person's unit

Every weight on screen is formatted and typed through `useWeightUnit()` — `formatEffort(…, unit)`,
`formatWeight(g, unit)`, and `DimensionInput`, which asks for the field in that unit itself. Never a
bare `formatWeight(g)`: that is kilograms, whatever the person chose in Settings. Storage is grams
either way; `fieldFor('weight', 'lb')` types pounds and stores the grams they are.

### What a write makes stale is derived, not listed

Every read declares, once, the source it is OF and the sources it EMBEDS — `READS` in
`packages/contract/src/reads.ts`. A `Workout` embeds `exercise`, because each entry carries its whole
exercise; a session embeds `workout`, because it points into its plan. A write names only the source
it changes (`useWriteTo('exercise', …)`), and `affectedBy` derives the rest: the reads OF it are
awaited — the next write may depend on them — and the reads that embed it refetch in the background.
A write that makes nothing stale — creating a media link, which is an exercise's only once the
exercise is saved with it — is a plain `useMutation`. A write to more than one names them all: a fix
to a finished session (#31) writes `['session', 'pastSession']`, the second refreshing the targets
carried over it, which a set logged leaves alone.

It used to be per write: each mutation listed what else it touched, and the lists had gaps nobody
could see. Renaming an exercise left the open plan, its progression and a live session showing the
old name for the whole `staleTime`. Query keys are flat — `[read, ...args]` — for the same reason: a
key nested under another was refreshed with it by accident, which is a dependency written nowhere.

A write the server REFUSES because what it names is gone or out of reach (404), or conflicts with
what is stored (409 — finished on another device, a session already in progress), may mean the
screen's picture is stale, because someone else's write changed it. `useWriteTo` then reads again what
the write was OF, the reads it would have awaited; when nothing has moved, it is a cheap re-read.
Not the ones that embed it, because nothing was written. A session whose plan the lifter had just
lost to a coach's edit used to keep showing it for the whole `staleTime`, inviting the same refused
set again.

Every read but the token list embeds `group`, because membership decides what it may answer:
leaving a group takes its plans, its exercises, and the names they lent your history. A group write
in the app — create, add, remove, leave — refreshes the groups and their members, and everything
else behind them. Someone else removing you still reaches the screen only the refused way above, as
it must: nothing in this app was written.

Leaving is `useDeleteOf('group', …)`: the group's own members are not asked for again by the screen
that left. Nothing else is skipped, on purpose. A plan from that group still open in another tab is
asked for again and says it does not exist — which, for you, it no longer does. Skipping it would
leave the plan on screen, inviting writes the server now refuses.

A delete (`useDeleteOf('workout', remove)`) refreshes none of the reads keyed by the id it deletes —
`[read, id]` is the thing itself — after it succeeds, or when it answers 404 because someone else
deleted it first. The detail screen that deleted the thing is still mounted when the refresh runs;
it asked for the thing again, was told it does not exist, and said so on the console, which fails
every e2e journey. Removing the query does not help: the mounted observer recreates it and asks
anyway. The keys are derived from their shape, not listed per delete, so a new read keyed by the id
is covered without anyone remembering it; they are collected once the screen showing them is gone.

A new read is a row in `READS` and a key in `keys`, whose type refuses one without the other and a
key that does not start with its read's name. The contract's T1 tests state each embedding as
behaviour; nothing ties `embeds` to the Zod shapes themselves, so a read that starts carrying another
source's data needs its row changed by hand.

### Configuration reaches the bundle only through dot access

`process.env.EXPO_PUBLIC_API_URL` — **never** `process.env['EXPO_PUBLIC_API_URL']`. Expo's Babel
plugin substitutes `EXPO_PUBLIC_*` for static member access only; bracket access is left alone and
evaluates to `undefined` in a built app, so a native build threw "EXPO_PUBLIC_API_URL must be set"
no matter what was set. Verified by grepping the bundle: with bracket access neither the value nor
the variable name appears in it.

`apps/app/types/env.d.ts` declares the variable as a real property, which is what lets dot access
coexist with `noPropertyAccessFromIndexSignature`.

It is **not** called `expo-env.d.ts`. That filename belongs to the Expo CLI, which regenerates it and
rewrites `tsconfig.json`'s `include` on every `expo start` / `expo export` — a declaration put there
is deleted the next time either runs, and the app then fails to typecheck with an index-signature
error that points nowhere near the cause.

### A rejected credential ends the session

`transport.ts` reports every `unauthenticated` answer to a request that sent a token, with the token
it sent; the session (`src/auth/session.ts`, made once in `http.ts`) signs out only if that is still
the token in use — a late 401 for a previous user's token must not sign the next one out. Every rule
about who is signed in is in that module, unit-tested (`session.test.ts`). The provider subscribes to
it, and clears the query cache whenever it says signed out — the one line of it in React, since the
cache is the root layout's.

Without it a token revoked elsewhere — signed out on another device, or simply expired after a month
— left every screen showing "Authentication required" with no way back to the login form. The guard
for it revokes the session server-side and then navigates WITHOUT a reload, because a reload would
exercise the restore-on-startup path instead, which is a different thing that already worked.

### Where the token lives

`src/auth/token-storage.ts` branches on `Platform.OS`: the OS keychain on native, `localStorage` on
web, with `expo-secure-store` imported lazily so the web bundle never evaluates it. The session takes
it as its `TokenStore`, so its tests use a fake one and never touch either.

**It branches rather than using a `.web.ts` file split, and that is not a style choice.** Metro picks
platform variants by extension, and this repo imports with explicit `.ts` extensions everywhere,
which resolves the literal file and silently skips the variant. The app called `expo-secure-store`
in a browser and every sign-in died on `getValueWithKeyAsync is not a function`. One file that
branches in the open cannot fail that way.

Documented tradeoff: a token in `localStorage` is XSS-reachable. Accepted for a self-hosted app with
no third-party scripts; moving to an httpOnly cookie touches this file and the login handler only.

### Auth status is not a boolean

`'loading' | 'signed-in' | 'signed-out' | 'unreachable'` — the session's `snapshot()`. On first paint
the stored token has not been read yet, and a router that treats "not known yet" as "signed out"
flashes the login screen at a returning user for one frame before bouncing them back.

`unreachable` is a stored token the server could not be asked about: no signal (the transport's
`NetworkError` — `fetch`'s own rejection is a bare `TypeError`, which a bug throws too), or the server
down behind its proxy (a 5xx, said in the console). Nobody refused it, so it is kept. The signed-in shell shows "Can't reach
your server", with **Try again** and **Sign out**. It used to be cleared like a rejected one, which
the installed app made the ordinary case: opened at the gym without a signal, it signed its user out
into needing a password, and a signal, to get back in. Only a 401 ends a session.

## The web build is a SPA, not prerendered

`app.json` sets `web.output: "single"` — one `index.html`, no server rendering.

**One bundle, deliberately.** Expo SDK 58 turns on async routes for web — a chunk per screen,
fetched on first navigation — and `app.json` turns them off (`asyncRoutes: { web: false }` on the
`expo-router` plugin). Each deploy replaces every chunk, so a tab left open across one broke on its
next first visit to any screen; expo-router caches the failed lazy import, so the error boundary's
"Try again" could never recover, and only a manual reload did. For an app behind a login on a home
server, splitting buys little load time and costs that. With one bundle, navigation never fetches
code.

Build output (`/_expo/static/*`, `/assets/*`) is content-hashed: served as files with a year-long
immutable header — only on a 2xx or 304 — and a missing file is a **404**, never the SPA fallback.
The Caddyfile and `e2e/server.ts` do the same, and `e2e/harness.e2e.ts` pins it.

`"static"` prerenders one HTML file per route, which cannot work for a route whose parameter is only
known at request time. Opening `/exercises/<id>` directly — a shared link, or just reloading a detail
screen — served markup rendered without that id, the client hydrated with it, and React threw
`#418: Hydration failed`. Every dynamic route was affected, and the route sweep never caught it
because it only visits routes without ids.

Nothing here wants server rendering: the whole app is behind authentication and is served from
someone's NAS, so there is no SEO and no first-paint budget to defend. Caddy's fallback is
correspondingly simple — `try_files {path} /index.html`.

## Logging without a signal

The app is online first. Offline it does one thing: log sets into a session started online, when
the signal drops mid-workout (#9). Opening the app and starting a session still need a signal. It
is TanStack Query's own queue, kept in memory, with no persistence library:

- A session's sets and its finish share one `scope` (`sessionQueue` in `src/api/write-to.ts`), so
  they run one at a time, in the order made. A finish never overtakes a set logged before it.
  Finishing without a signal therefore waits too, and goes once the sets before it have.
- Offline, they wait (TanStack's `onlineManager`, from the browser's online and offline events), and
  go when the signal is back.
- A set's `Idempotency-Key` is made once, when it is logged. A send that gets no answer, or a 5xx,
  is retried under it, up to ten sends, with TanStack's own wait between them: a second, doubling to
  thirty (`src/api/retry.ts`, a plain module with its unit test). A refusal is not retried. Neither
  is a set that runs out of sends: it is dropped, and the screen says why, so no set holds the
  queue, or the finish behind it, forever.
- A set not yet sent shows at once, as "not sent yet" (`UnsentSets`). When one is held up (no
  signal, or sent again), one line asks: "Keep cedo open — N sets will be sent when the signal is
  back". The logger is held only while a set's first send is on its way, as before. Once one waits,
  the next is logged behind it. Logging has its own `useSubmit`, so a waiting set never holds the
  Finish button.
- Closing or reloading the app before the signal returns loses the sets still waiting. Accepted:
  offline is the rare case, and anything done online wins.

A set is stamped when it reaches the server, as always. So after a late send, the rest timer counts
from arrival.

## The installed app

`public/` is copied into the export as is: `index.html` is the template Expo injects the bundle into,
and carries the manifest link and the tags iOS reads instead of a manifest. `manifest.webmanifest`
and the icons sit beside it. The icons are rendered from `public/icons/icon.svg`; its comment gives
the command.

The service worker keeps the **app shell**, and nothing else: the one document, and the bundle it
names. It is authored in TypeScript (`src/pwa/`), and `bun run export` bundles it on its own into
`dist/sw.js`, served from the root so its scope is the whole app. It is registered only in a build,
never over the dev server. The rules live in `shell-cache.ts`:

- **A page of the app** is answered from the kept document at once, while the network's copy
  replaces it for the next opening (stale-while-revalidate). So an install opens instantly and
  without a signal, and a deployment arrives one opening late.
- **Build output** is answered from what was kept, or fetched once and kept: it is content-hashed.
- **A new document is kept only once its bundle is.** Two bundle generations stay, because a page
  still open on the old document asks for the old bundle. An error page is never kept.
- **`/api`, writes, and other origins** are never touched. A stale read of training data is a
  wrong one, and a set logged without a signal is #9.

## Development runs the same shape as production

`bun run dev` starts the API on :3000 and Metro on :8081. The app calls the relative path `/api` in
both, because `apps/app/metro.config.js` proxies `/api/*` to the API — the development counterpart
of the Caddyfile.

That indirection is the point. Pointing the app at `http://localhost:3000` instead would make every
development request cross-origin, which would need CORS on the API, which the whole three-container
shape exists to avoid. Without the proxy the app came up looking fine and every request 404'd
against Metro. See `docs/09-deployment.md`.

`CEDO_DEV_API_ORIGIN` overrides the target if the API is not on :3000.

## Seeing what you built

```bash
bun run shot /exercises            # render, screenshot to .artifacts/, print console errors
bun run shot /workouts --tablet
bun run gallery                    # every screen in use, mobile and desktop, to .artifacts/gallery/
bun run e2e                        # static routes at phone width, the tablet shell, the journeys;
                                   # fails on any console error, including any failed read
```

`bun run shot` is the inner loop: edit a screen, run it, **read the PNG**, read the errors. Both the
sidebar bug and the platform-resolution bug above were found by looking at the picture, not by an
assertion.

`bun run gallery` is the outer one, for judging how the app looks and flows rather than whether a
route renders. It seeds an athlete three weeks into a block — a four-day plan, dated history, a
session half done with rest running, an exercise with a video, a coach's club — and photographs
every screen and the states inside them (the picker open, a set mid-rest) at a phone's width and a
laptop's, each down to its end, a frame per viewport — every scroller on screen scrolled together,
so a desktop's two columns read side by side as they are laid out. `.artifacts/gallery/index.html`
lays mobile and desktop side by side. `--only <state>` and `--layout mobile|desktop` narrow it. An
empty account cut at the fold hid every problem in `docs/ux/2026-10-ui-review.md`; this is what
found them.

The harness reveals a target before touching it (`scrollIntoView`, then click) and can wait for a
selector whose id is not known ahead of time. Both exist because their absence produced failures
about viewport geometry and query timing rather than about the app.

Adding a screen: give every element a `testID`, add it to the sweep in `e2e/routes.e2e.ts` and, for
a journey, to its driver in `e2e/screens/`, and run `bun run e2e`. The harness fails on any console error without a single hand-written assertion, so
the sweep is coverage rather than a set of expectations. See `docs/10-testing.md`.

## One rule is calibrated differently here

`max-lines-per-function` is 50 across the repo and **120 for `.tsx` files in the app**.

The rule is a proxy for complexity, and it is a good one for imperative code. A declarative render
function is a different shape: a form with six fields is a hundred lines of markup with one branch
in it, and splitting it into `<TopHalf>` and `<BottomHalf>` makes it harder to read, not easier.

Every genuinely separable piece has been extracted — `Loaded`, `FormError`, `MuscleOptions`,
`TokenList`, `History`, `EntryEditor`. What remains long is markup. If a screen approaches 120 lines
it is usually because it grew a rule, and the rule belongs in `@cedo/contract`.
