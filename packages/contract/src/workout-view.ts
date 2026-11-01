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

/**
 * What the workout screen shows (#24): the focus (GLOSSARY.md), the set shown above it, and "+ set"
 * — from the session's sets and what the athlete chose. Pure, so the screen only renders it and
 * holds the choices. The flow it reads is `session-flow.ts`; see docs/08-frontend.md.
 */

/** What these rules read of a set as the workout shows it: the exercise it is of, too. */
type ViewLog = FlowLog & { readonly exerciseId: string }

/**
 * The exercise a set logged with no plan entry goes to (#24): the one chosen, else one just added
 * and not yet logged — each exercise added becomes the focus — else that of the set logged last,
 * else the last there is.
 */
export function adHocFocus<X extends { readonly id: string }>(
  exercises: readonly X[],
  logs: readonly ViewLog[],
  chosen: string | null,
  justAdded: string | null,
): X | undefined {
  const of = (id: string | null | undefined) => exercises.find((e) => e.id === id)
  const fresh =
    justAdded !== null && !logs.some((l) => l.exerciseId === justAdded) ? justAdded : null
  const latest = logs.at(-1)
  return (
    of(chosen) ??
    of(fresh) ??
    (latest?.entryId === null ? of(latest.exerciseId) : undefined) ??
    exercises.at(-1)
  )
}

/** A set re-opened from its mark: of a plan entry, or of an exercise logged with none. */
export interface Reopened {
  readonly entryId: string | null
  readonly exerciseId: string
  /** The set's key among its entry's — or exercise's — sets (`SessionSet.key`). */
  readonly key: string
}

/**
 * What the athlete chose on the workout screen (GLOSSARY.md, "Focus"): an entry of the day or an
 * exercise logged with none, tapped to put in focus, and a set re-opened from its mark. The screen
 * holds them until the athlete logs or undoes a set, or goes to pick an exercise; these rules only
 * read them.
 */
export interface WorkoutChoices {
  readonly chosen: { readonly entry: string } | { readonly added: string } | null
  readonly reopened: Reopened | null
}

export const NO_CHOICES: WorkoutChoices = { chosen: null, reopened: null }

type Loggable<E extends FlowEntry> = E & { readonly exercise: NonNullable<E['exercise']> }

const loggable = <E extends FlowEntry>(entry: E): entry is Loggable<E> => entry.exercise !== null

/**
 * What the focus is on: an entry, one out of the reader's reach, a swap or an exercise added, the
 * day all done — or, a session without a plan with nothing picked, nothing.
 */
export type Focused<
  E extends FlowEntry,
  X,
  L extends ViewLog,
  T extends { readonly entryId: string },
> =
  | {
      readonly kind: 'entry'
      readonly entry: Loggable<E>
      readonly sets: SessionSet<L>[]
      /** What this session asks of it, once read. */
      readonly asked: T | undefined
      /** The key of its set re-opened from its mark, or null. */
      readonly selected: string | null
    }
  | { readonly kind: 'unavailable'; readonly entry: E }
  | {
      readonly kind: 'added'
      readonly exercise: X
      readonly sets: SessionSet<L>[]
      readonly selected: string | null
    }
  | { readonly kind: 'done' }
  | { readonly kind: 'none' }

/** The workout screen, as these rules decide it; `workoutView`'s answer. */
export interface WorkoutView<
  E extends FlowEntry,
  X,
  L extends ViewLog,
  T extends { readonly entryId: string },
> {
  readonly focus: Focused<E, X, L, T>
  /** The set shown above the focus — re-opened from its mark, else the one logged last. */
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

interface ViewInput<
  E extends FlowEntry,
  X extends { readonly id: string },
  L extends ViewLog,
  T extends { readonly entryId: string; readonly target: SetTarget },
> {
  /** The day the session follows, or null: a session without a plan, or one out of reach. */
  readonly day: { readonly entries: readonly E[] } | null
  readonly targets: readonly T[]
  /** Every set the session holds, those waiting for a signal too, in the order logged. */
  readonly sets: readonly L[]
  /** The exercises logged with no plan entry, then any added since (`exercisesInSession`). */
  readonly added: readonly X[]
  /**
   * The first of the exercises added last. Without a plan, it takes the focus until a set of it is
   * logged. Following a day, while it is the last of those added, it has the focus whenever nothing
   * else is chosen — sets of it logged or not, and over the day's order — until another is picked.
   */
  readonly justAdded: string | null
  readonly choices: WorkoutChoices
  /** What the athlete can load on an entry's exercise (#36). */
  readonly loadFor: (entry: E) => Load | null
}

/** What both kinds of session read alike: an entry's sets, an exercise added in focus, a set re-opened. */
function readsOf<
  E extends FlowEntry,
  X extends { readonly id: string },
  L extends ViewLog,
  T extends { readonly entryId: string; readonly target: SetTarget },
>(input: ViewInput<E, X, L, T>) {
  const { targets, sets, added, choices } = input
  const { chosen, reopened } = choices
  const asked = (entry: E) => targets.find((t) => t.entryId === entry.id)
  return {
    ...input,
    reopened,
    asked,
    chosenEntry: chosen !== null && 'entry' in chosen ? chosen.entry : null,
    chosenAdded: chosen !== null && 'added' in chosen ? chosen.added : null,
    setsFor: (entry: E) => setsOf(entry, sets, asked(entry)?.target ?? null, input.loadFor(entry)),
    adHocShown: (r: Reopened) =>
      adHocSetsOf(r.exerciseId, sets).find((s) => s.key === r.key)?.log ?? null,
    addedFocus: (exercise: X): Focused<E, X, L, T> => ({
      kind: 'added',
      exercise,
      sets: adHocSetsOf(exercise.id, sets),
      selected:
        reopened?.entryId === null && reopened.exerciseId === exercise.id ? reopened.key : null,
    }),
    exerciseOf: (log: L) => added.find((e) => e.id === log.exerciseId) ?? null,
  }
}

type Reads<
  E extends FlowEntry,
  X extends { readonly id: string },
  L extends ViewLog,
  T extends { readonly entryId: string; readonly target: SetTarget },
> = ReturnType<typeof readsOf<E, X, L, T>>

/**
 * What the workout screen shows (#24), from the session's sets and what the athlete chose.
 *
 * Following a day, the focus is the entry chosen — else an exercise added (chosen, just added, or
 * the one a swap was logged to last) — else `focusOf`'s; an entry chosen out of the reader's reach
 * says so, and with every set logged the day is done. Without a plan, the focus is `adHocFocus`'s.
 *
 * The set shown is the one re-opened from its mark, else the one logged last — without a plan, the
 * last logged with no entry.
 */
export function workoutView<
  E extends FlowEntry,
  X extends { readonly id: string },
  L extends ViewLog,
  T extends { readonly entryId: string; readonly target: SetTarget },
>(input: ViewInput<E, X, L, T>): WorkoutView<E, X, L, T> {
  if (input.day !== null) return dayView(input.day, readsOf(input))
  // A set re-opened on a plan entry — the plan out of reach since — is none of these sets: their
  // keys count again from `s0`, and would name another.
  const { reopened } = input.choices
  const own = reopened?.entryId === null ? reopened : null
  return adHocView(readsOf({ ...input, choices: { ...input.choices, reopened: own } }))
}

/** A session without a plan: an exercise added in focus, and the last set logged of one. */
function adHocView<
  E extends FlowEntry,
  X extends { readonly id: string },
  L extends ViewLog,
  T extends { readonly entryId: string; readonly target: SetTarget },
>(r: Reads<E, X, L, T>): WorkoutView<E, X, L, T> {
  const focus = adHocFocus(r.added, r.sets, r.chosenAdded, r.justAdded)
  const log =
    r.reopened === null ? r.sets.findLast((l) => l.entryId === null) : r.adHocShown(r.reopened)
  return {
    focus: focus === undefined ? { kind: 'none' } : r.addedFocus(focus),
    shown: log == null ? null : { log, exercise: r.exerciseOf(log) },
    another: null,
    current: { upNext: null, addedToday: focus?.id ?? null },
    setsFor: r.setsFor,
  }
}

/** A session that follows a day: its entries, and the swaps and exercises added to it. */
function dayView<
  E extends FlowEntry,
  X extends { readonly id: string },
  L extends ViewLog,
  T extends { readonly entryId: string; readonly target: SetTarget },
>(day: { readonly entries: readonly E[] }, r: Reads<E, X, L, T>): WorkoutView<E, X, L, T> {
  const latest = r.sets.at(-1)
  const chosen = day.entries.find((e) => e.id === r.chosenEntry)
  const addedNext = adHocFocus(r.added, r.sets, r.chosenAdded, r.justAdded)
  // An exercise added is in focus when chosen, just added, or the one a swap was logged to last.
  const addedInFocus =
    chosen === undefined &&
    addedNext !== undefined &&
    (r.chosenAdded !== null || r.justAdded === addedNext.id || latest?.entryId === null)
      ? addedNext
      : undefined
  const next = chosen !== undefined && loggable(chosen) ? chosen : focusOf(day, r.sets)

  const shownEntry = day.entries.find((e) => e.id === (r.reopened?.entryId ?? latest?.entryId))
  const log = shownOfDay(r, shownEntry, latest)
  const another =
    shownEntry !== undefined &&
    nextSet(r.setsFor(shownEntry)) === null &&
    log?.entryId === shownEntry.id
      ? shownEntry.id
      : null
  return {
    focus: dayFocus(r, chosen, addedInFocus, next),
    shown: log === null ? null : { log, exercise: shownEntry?.exercise ?? r.exerciseOf(log) },
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
function dayFocus<
  E extends FlowEntry,
  X extends { readonly id: string },
  L extends ViewLog,
  T extends { readonly entryId: string; readonly target: SetTarget },
>(
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
    selected: r.reopened?.entryId === next.id ? r.reopened.key : null,
  }
}

/** The set a day shows above its focus: re-opened from its mark, else the one logged last. */
function shownOfDay<
  E extends FlowEntry,
  X extends { readonly id: string },
  L extends ViewLog,
  T extends { readonly entryId: string; readonly target: SetTarget },
>(r: Reads<E, X, L, T>, shownEntry: E | undefined, latest: L | undefined): L | null {
  const { reopened } = r
  if (reopened === null) return latest ?? null
  if (reopened.entryId === null) return r.adHocShown(reopened)
  if (shownEntry === undefined) return null
  return r.setsFor(shownEntry).find((s) => s.key === reopened.key)?.log ?? null
}
