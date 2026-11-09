import type { Load } from './load.ts'
import type { SetTarget } from './progression.ts'
import {
  type FlowEntry,
  type FlowLog,
  type SessionSet,
  adHocSetsOf,
  focusOf,
  nextSet,
  setsOf,
} from './session-flow.ts'
import type { Chosen, Undone, WorkoutChoices } from './workout-choices.ts'

/**
 * What the workout screen shows (#24): the focus (GLOSSARY.md), the set just logged, and "+ set"
 * — from the session's sets and what the athlete chose (`workout-choices.ts`). Pure, so the screen
 * only renders it and holds the choices. The flow it reads is `session-flow.ts`; see
 * docs/08-frontend.md.
 */

/** What these rules read of a set as the workout shows it: the exercise it is of, too. */
type ViewLog = FlowLog & { readonly exerciseId: string }
/** What they read of an exercise added to a session, and of what the session asks of an entry. */
type Added = { readonly id: string }
type EntryAsked = {
  readonly entryId: string
  readonly target: SetTarget
  readonly working: readonly SetTarget[]
  readonly warmups: readonly SetTarget[]
}

/**
 * The exercise a set logged with no plan entry goes to (#24): the one chosen — each exercise picked
 * is chosen, so it takes the focus — else that of the set logged last, else the last there is.
 */
function adHocFocus<X extends Added>(
  exercises: readonly X[],
  logs: readonly ViewLog[],
  chosen: string | null,
): X | undefined {
  const of = (id: string | null | undefined) => exercises.find((e) => e.id === id)
  const latest = logs.at(-1)
  return (
    of(chosen) ?? (latest?.entryId === null ? of(latest.exerciseId) : undefined) ?? exercises.at(-1)
  )
}

/**
 * The exercise a set is of, as the workout names it — the set just logged, or one waiting for a
 * signal, which the server has not named yet: its entry's in the day, else the exercise added to
 * the session. Null when neither names it.
 */
export function exerciseOfSet<E extends FlowEntry, X extends Added>(
  day: { readonly entries: readonly E[] } | null,
  added: readonly X[],
  set: Pick<ViewLog, 'entryId' | 'exerciseId'>,
): NonNullable<E['exercise']> | X | null {
  return (
    day?.entries.find((e) => e.id === set.entryId)?.exercise ??
    added.find((e) => e.id === set.exerciseId) ??
    null
  )
}

type Loggable<E extends FlowEntry> = E & { readonly exercise: NonNullable<E['exercise']> }

const loggable = <E extends FlowEntry>(entry: E): entry is Loggable<E> => entry.exercise !== null

/** An entry in focus: its sets, what this session asks of it, and its set just undone. */
export interface FocusedEntry<E extends FlowEntry, L extends ViewLog, T extends EntryAsked> {
  readonly kind: 'entry'
  readonly entry: Loggable<E>
  readonly sets: SessionSet<L>[]
  /** What this session asks of it, once read. */
  readonly asked: T | undefined
  /** Its set just undone, which the logger starts from — or null. */
  readonly undone: Undone | null
}

/** An exercise added in focus — a swap, or one of a session without a plan. */
export interface FocusedAdded<X extends Added, L extends ViewLog> {
  readonly kind: 'added'
  readonly exercise: X
  readonly sets: SessionSet<L>[]
  readonly undone: Undone | null
}

/**
 * What the focus is on: an entry, one out of the reader's reach, a swap or an exercise added, the
 * day all done — or, a session without a plan with nothing picked, nothing.
 */
export type Focused<
  E extends FlowEntry,
  X extends Added,
  L extends ViewLog,
  T extends EntryAsked,
> =
  | FocusedEntry<E, L, T>
  | { readonly kind: 'unavailable'; readonly entry: E }
  | FocusedAdded<X, L>
  | { readonly kind: 'done' }
  | { readonly kind: 'none' }

/** The workout screen, as these rules decide it; `workoutView`'s answer. */
export interface WorkoutView<
  E extends FlowEntry,
  X extends Added,
  L extends ViewLog,
  T extends EntryAsked,
> {
  readonly focus: Focused<E, X, L, T>
  /** The set logged last — without a plan, the last logged with no entry; none after an undo. */
  readonly shown: {
    readonly log: L
    readonly exercise: NonNullable<E['exercise']> | X | null
  } | null
  /** The entry "+ set" adds one more to: that of the set shown, once it has all it asked for. */
  readonly another: string | null
  /** The rows marked as in focus: of the day (Up next), and of the exercises added to it. */
  readonly current: { readonly upNext: E | null; readonly addedToday: string | null }
  /** An entry's sets, as the session asks them of the athlete. */
  readonly setsFor: (entry: E) => SessionSet<L>[]
}

interface ViewInput<E extends FlowEntry, X extends Added, L extends ViewLog, T extends EntryAsked> {
  /** The day the session follows, or null: a session without a plan, or one out of reach. */
  readonly day: { readonly entries: readonly E[] } | null
  readonly targets: readonly T[]
  /** Every set the session holds, those waiting for a signal too, in the order logged. */
  readonly sets: readonly L[]
  /** The exercises logged with no plan entry, then any added since (`exercisesInSession`). */
  readonly added: readonly X[]
  readonly choices: WorkoutChoices
  /** What the athlete can load on an entry's exercise (#36). */
  readonly loadFor: (entry: E) => Load | null
}

/**
 * What both kinds of session read alike: an entry's sets, an exercise added in focus, a set undone.
 */
function readsOf<E extends FlowEntry, X extends Added, L extends ViewLog, T extends EntryAsked>(
  input: ViewInput<E, X, L, T>,
) {
  const { targets, sets, added, choices } = input
  const { undone } = choices
  // A set undone chooses its own entry — or exercise — unless something was chosen after it.
  const chosen: Chosen | null =
    choices.chosen ??
    (undone === null
      ? null
      : undone.entryId === null
        ? { added: undone.exerciseId }
        : { entry: undone.entryId })
  const asked = (entry: E) => targets.find((t) => t.entryId === entry.id)
  return {
    ...input,
    asked,
    chosenEntry: chosen !== null && 'entry' in chosen ? chosen.entry : null,
    chosenAdded: chosen !== null && 'added' in chosen ? chosen.added : null,
    setsFor: (entry: E) => setsOf(entry, sets, asked(entry) ?? null, input.loadFor(entry)),
    undoneOf: (entry: E): Undone | null => (undone?.entryId === entry.id ? undone : null),
    addedFocus: (exercise: X): Focused<E, X, L, T> => ({
      kind: 'added',
      exercise,
      sets: adHocSetsOf(exercise.id, sets),
      undone: undone?.entryId === null && undone.exerciseId === exercise.id ? undone : null,
    }),
    exerciseOf: (log: L) => exerciseOfSet(input.day, added, log),
  }
}

type Reads<
  E extends FlowEntry,
  X extends Added,
  L extends ViewLog,
  T extends EntryAsked,
> = ReturnType<typeof readsOf<E, X, L, T>>

/**
 * What the workout screen shows (#24), from the session's sets and what the athlete chose.
 *
 * Following a day, the focus is the entry chosen — else an exercise added (chosen, or the one a swap
 * was logged to last) — else `focusOf`'s; an entry chosen out of the reader's reach
 * says so, and with every set logged the day is done. Without a plan, the focus is `adHocFocus`'s.
 *
 * The set shown is the one logged last — without a plan, the last logged with no entry — and none
 * after an undo, until the next set. A set undone chooses its own entry, which starts from what it
 * said.
 */
export function workoutView<
  E extends FlowEntry,
  X extends Added,
  L extends ViewLog,
  T extends EntryAsked,
>(input: ViewInput<E, X, L, T>): WorkoutView<E, X, L, T> {
  const { undone } = input.choices
  const view =
    input.day === null
      ? // A set undone on a plan entry — the plan out of reach since — is of no exercise logged
        // with none.
        adHocView(
          readsOf({
            ...input,
            choices: { ...input.choices, undone: undone?.entryId === null ? undone : null },
          }),
        )
      : dayView(input.day, readsOf(input))
  // Undo ends the rest with its set (#63): the set before is not just logged again — nor its rest,
  // nor its Undo — until the next set is. Log is back.
  return undone === null ? view : { ...view, shown: null, another: null }
}

/** A session without a plan: an exercise added in focus, and the last set logged of one. */
function adHocView<E extends FlowEntry, X extends Added, L extends ViewLog, T extends EntryAsked>(
  r: Reads<E, X, L, T>,
): WorkoutView<E, X, L, T> {
  const focus = adHocFocus(r.added, r.sets, r.chosenAdded)
  const log = r.sets.findLast((l) => l.entryId === null)
  return {
    focus: focus === undefined ? { kind: 'none' } : r.addedFocus(focus),
    shown: log == null ? null : { log, exercise: r.exerciseOf(log) },
    another: null,
    current: { upNext: null, addedToday: focus?.id ?? null },
    setsFor: r.setsFor,
  }
}

/** A session that follows a day: its entries, and the swaps and exercises added to it. */
function dayView<E extends FlowEntry, X extends Added, L extends ViewLog, T extends EntryAsked>(
  day: { readonly entries: readonly E[] },
  r: Reads<E, X, L, T>,
): WorkoutView<E, X, L, T> {
  const latest = r.sets.at(-1)
  const chosen = day.entries.find((e) => e.id === r.chosenEntry)
  const addedNext = adHocFocus(r.added, r.sets, r.chosenAdded)
  // An exercise added is in focus when chosen — picked, or tapped — or the one a swap was logged to
  // last; a set of the day gives the day its focus back.
  const addedInFocus =
    chosen === undefined &&
    addedNext !== undefined &&
    (r.chosenAdded !== null || latest?.entryId === null)
      ? addedNext
      : undefined
  const next = chosen !== undefined && loggable(chosen) ? chosen : focusOf(day, r.sets)

  const shownEntry = day.entries.find((e) => e.id === latest?.entryId)
  const log = latest ?? null
  const another =
    shownEntry !== undefined &&
    nextSet(r.setsFor(shownEntry)) === null &&
    log?.entryId === shownEntry.id
      ? shownEntry.id
      : null
  return {
    focus: dayFocus(r, chosen, addedInFocus, next),
    shown: log === null ? null : { log, exercise: r.exerciseOf(log) },
    another,
    current: {
      // The entry chosen is the row marked, out of the reader's reach or not: it is what is shown.
      upNext: addedInFocus === undefined ? (chosen ?? next) : null,
      addedToday: addedInFocus?.id ?? null,
    },
    setsFor: r.setsFor,
  }
}

/** What a day has in focus, of the entry chosen, the exercise added in focus, and the day's next. */
function dayFocus<E extends FlowEntry, X extends Added, L extends ViewLog, T extends EntryAsked>(
  r: Reads<E, X, L, T>,
  chosen: E | undefined,
  addedInFocus: X | undefined,
  next: E | null,
): Focused<E, X, L, T> {
  if (chosen !== undefined && !loggable(chosen)) return { kind: 'unavailable', entry: chosen }
  if (addedInFocus !== undefined) return r.addedFocus(addedInFocus)
  if (next === null || !loggable(next)) return { kind: 'done' }
  return {
    kind: 'entry',
    entry: next,
    sets: r.setsFor(next),
    asked: r.asked(next),
    undone: r.undoneOf(next),
  }
}
