# Frontend

Expo SDK 58 / React Native 0.88 / React 19.3, with `expo-router`. Web-mobile-first, plus a tablet
two-pane layout. It depends on **`@cedo/contract` and nothing else** from this repo.

## The thinness rule

This is the rule the whole frontend is organised around, and the reason the test suite can be as
small as it is.

> A screen **may**: call the hooks in `src/api/queries.ts` and `src/api/session-queries.ts` (never
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
app/(app)/settings/         index · groups/index · groups/[id]/index · tokens · connect

src/ui/                      the entire visual vocabulary
src/api/                     transport.ts, client.ts, http.ts, errors.ts, query-client.ts, queries.ts,
                             session-queries.ts (a session's writes and its offline queue),
                             retry.ts and pending.ts (+ their unit tests)
src/auth/                    session.ts (+ its unit test), auth-provider.tsx, token-storage.ts
src/pwa/                     shell-cache.ts (+ its unit test), service-worker.ts, register.ts
src/lib/                     use-submit.ts, plan-draft.ts, forms, pickers, group-placement.tsx, duplicate-into-my-group.tsx
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
| `PinButton` | pinning what you can see, for its list's "Pinned" filter |
| `ProgressTrend` | an exercise's progress: a bar per session from the contract's `trendOf` — the estimated max of a weight lift, the top set otherwise — and the server's stall as a badge |
| `Field`, `Input`, `NumberInput`, `DimensionInput`, `CompactField` | forms. `NumberInput` is a count; a measured quantity is a `DimensionInput`. `Input`'s `look` sets a name edited where it reads — a workout's title, a day's heading — with no box |
| `Card`, `ListRow` | the one row shape every list uses |
| `Chips` | one choice from a short flat set — list scopes, tracking mode, progression kind |
| `Empty`, `Spinner`, `ErrorNotice`, `FormError` | the four states that are not "content" |
| `Loaded` | failed / not-yet / here, around any query. A screen never writes that ternary |
| `ErrorBoundary` | the last line of defence |
| `Sheet` | something looked at without leaving where you are — a session's menu, how to do an exercise. From the bottom on a phone, in the middle on a desktop |
| `Icon`, `IconButton` | a secondary action as a glyph alone — back, menu, close, undo, how to — named aloud by its label |
| `Columns` | a screen's main part and what it sits within: one column on a phone, side by side on a desktop |
| `Thumbnail` | a picture of a movement: a video's thumbnail, an uploaded image |
| `color`, `space`, `radius`, `type`, `font`, `CONTENT_MAX_WIDTH`, `WIDE_CONTENT_MAX_WIDTH`, `CONTROL_HEIGHT`, `LOG_CONTROL_HEIGHT`, `ROW_HEIGHT`, `ICON_SIZE` | the only source of visual values |
| `useAppFonts()` | the bundled faces `font` names, loaded beside the app at its root — never waited for |
| `useLayout()`, `TABLET_MIN_WIDTH` | the only layout branch: `'phone' | 'tablet'`, and where it switches |

Composites are here rather than in a screen, because each is used from more than one place or
would otherwise be copied: `MusclePicker`, `EntryEditor` (one plan entry's fields, opened from its
line in a workout's outline, #26), and the
workout's (#24) — `FocusLogger` (the exercise in focus: its `SetMarks`, the next set's `Stepper`s,
one Log button), `LastSet` (the set just logged: a best, its reserve, Undo), `RestBand`, `UpNext`
and `AddRow`,
`SessionHeader` and `ReturnBar`; and Today's (#25) — `WeekStrip`, a week's days as the contract's
`weekStrip` gives them. They are still presentational — the rules they render (loads
summing to 100, which inputs a tracking mode implies, what a progression rule contains, which set
is next, where the focus goes, whose rest runs, what a set is called) all live in `@cedo/contract`:
`session-flow.ts` and `set-marks.ts` for the workout. An unavailable exercise has no mode, so no
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
browser, nothing bundled.

Sets logged without a signal (#9) count as done on the workout — the next set comes up, rest
starts — through `withPending` (`src/api/pending.ts`): app-owned state with no React in it, so
unit-tested beside it, like `retry.ts`. Each is dated after the latest stored set, so a server
clock ahead of the device cannot send the focus back to a set already done.

A composite that reads through a query hook is not presentational, so it lives in `src/lib/`
instead: the exercise picker, and `GroupPlacement` — which group an exercise or plan is in, and
Transfer to group, on both detail screens. Where it may go is the server's `canTransferInto`, not a rule
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
one Log button under the thumb. "Up next" is the rest of the day, an entry to a line, a superset
drawn as one item; tapping one makes it current, and tapping a logged set re-opens it.

- **Logging moves the focus** to the entry's next set, then to the next entry in day order with
  sets left. Entries of a superset alternate, and rest starts after the pair.
- **Rest starts on its own** when a set is logged: a countdown band with +30 s and × to skip it,
  above the set it follows; at zero the band changes colour and sounds once if the app is open. No background
  notification — an installed web app cannot send one reliably on an iPhone.
- **Reserve is asked after**, as one optional row on the set just logged, and only for an exercise
  measured in reps. Which those are is the contract's, not the screen's. Whole reps, none to five,
  one row of segments; tapping the chosen one again takes it back.
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

As built (#25), on a phone top to bottom, on a desktop in two `Columns`:

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

The app says where its week starts (`startOfWeek`, local Monday); the server cannot know the
reader's time zone. Weeks and lines are the contract's `week.ts`.

### Editing a workout

The workout's page is its outline: days, and each entry one line — "Barbell Back Squat · 5 × 5 ·
100 kg · +2.5 kg a session". Tapping a line opens the entry's settings in a sheet, or a panel beside
the outline on a wide screen. Each change is saved as it is made, and there is no edit mode: see
`docs/adr/0022-plans-edited-in-place.md`. Days and entries reorder, entries move between days, and a
workout is renamed and its notes edited where they are shown.

As built (#26):

- **The head** — back, the name set as the title it is and edited there, the notes under it, each
  kept as its field is left; then one line on the plan: Saved, Saving…, or Not saved and why.
- **The outline** — each day its name (edited where it reads, kept as the field is left and put
  back if left empty — no day is nameless), Start, ↑ ↓ and the bin; each entry one line, `5 sets · 5 × 100 kg · Linear, +2.5 kg`, a superset's letter before its name; Add exercise
  at the foot of a day, Add day at the foot of the plan. An unavailable exercise's line says so,
  with the bin.
- **An entry's settings** — its fields (`EntryEditor`), then where it is in the plan: chips to move
  it to another day, ↑ ↓ within its day, the bin. In a sheet on a phone; on a desktop, a panel
  beside the outline (`Columns`), which waits with a line until an entry is chosen. Kept open by
  the entry's key, so it follows the entry as it moves and closes once it is gone.
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
- What is done to the workout whole — pin, its group, delete — sits under the outline; a reader
  sees the same outline with nothing to tap but Start, and Copy into my group under it.
- `/workouts/:id/edit` redirects to the workout's page, for old links.

### Finding exercises

Search, and a muscle filter grouped by region; each row its main muscles, and the video's thumbnail
when there is one. The picker leads with what you have logged lately, marks what the day already
has, and adds several at once. A new exercise starts from its muscles, their loads an even split
that totals 100, to adjust.

### Progress, and the tabs

**Today · Workouts · Exercises · Progress · Settings.** Progress is the training review — sessions a
week and the streak, days skipped, work per muscle against the period before, and what has stalled,
is falling or is drifting — the same read the AI gets, over HTTP.

### Desktop

Two panes where reading side by side helps: a workout's outline beside the entry being edited, the
exercise list beside the exercise, Today's next session and week beside the history — and the
session: what was just done and the exercise in focus, beside the day and its sets (`Columns`). One
column 700 points wide made the Log button the loudest thing on a desk, which it is not there. A
session left open is the same yellow band as on a phone, at the foot of the sidebar — a line with a
yellow dot was tried and read as too little; a sheet opens in the middle of the screen, not from
its bottom edge. The sidebar carries the product's name and the
account.

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
exercise is saved with it — is a plain `useMutation`.

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
laptop's, each down to its end, a frame per viewport. `.artifacts/gallery/index.html` lays mobile
and desktop side by side. `--only <state>` and `--layout mobile|desktop` narrow it. An empty
account cut at the fold hid every problem in `docs/ux/2026-10-ui-review.md`; this is what found them.

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
