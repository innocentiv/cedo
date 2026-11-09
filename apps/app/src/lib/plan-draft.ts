import type { Workout, WorkoutDayInput, WorkoutEntryInput, WorkoutPlanInput } from '@cedo/contract'
import { newEntry, planInputFrom } from '@cedo/contract'

/**
 * The workout page's copy of a plan (#26), as it is edited in place.
 *
 * `PUT /workouts/:id/plan` replaces the entire plan in one transaction, so the page holds the whole
 * thing and sends it whole. Indices are array position and are assigned by the server, which is why
 * nothing here carries one — reordering is a plain array move.
 * See docs/06-api.md and docs/adr/0022-plans-edited-in-place.md.
 *
 * Each day and entry carries a `key` the page alone knows it by — its id once it has one, a key made
 * here until then — so the id the server gives a new one can be found again in the copy after it,
 * and sent back with the next save (`plan-sync.ts`). Without it, every save would make the new
 * entries new again.
 *
 * Functions over plain data — pure, but for `newKey`'s count — with no React and no network. The
 * RULES of editing a plan — new days and
 * entries, set counts, limits, what a target change applies to — are the contract's
 * (`plan-editing.ts`), where they are tested; this file only moves draft data around.
 */

export type EntryDraft = WorkoutEntryInput & { readonly key: string }
export type DayDraft = Omit<WorkoutDayInput, 'entries'> & {
  readonly key: string
  readonly entries: EntryDraft[]
}

/** Where an entry is in the plan: its day, and its place in that day. */
export interface EntryAt {
  readonly day: number
  readonly entry: number
}

let made = 0
/** A key for a day or entry the page adds, until the server gives it an id. */
const newKey = (): string => {
  made += 1
  return `new-${String(made)}`
}

/** A day as the page knows it: its id as its key, or a key made here until it has one. */
export const keyDay = (day: WorkoutDayInput): DayDraft => ({
  ...day,
  key: day.id ?? newKey(),
  entries: day.entries.map(keyEntry),
})

export const keyEntry = (entry: WorkoutEntryInput): EntryDraft => ({
  ...entry,
  key: entry.id ?? newKey(),
})

/**
 * Carries every day's and entry's id, so saving keeps the logged history attached to them — see
 * `planInputFrom`.
 */
export const draftFrom = (workout: Workout): DayDraft[] => planInputFrom(workout).days.map(keyDay)

/** The plan as it is sent: the page's keys left behind. */
export const toPlanInput = (days: readonly DayDraft[]): WorkoutPlanInput => ({
  days: days.map(({ key: _day, entries, ...day }) => ({
    ...day,
    entries: entries.map(({ key: _entry, ...entry }) => entry),
  })),
})

export function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, i) => (i === index ? next : item))
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index)
}

/** Reordering is a move, because indices are array position. Out-of-range moves are a no-op. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return [...items]
  const copy = [...items]
  const [moved] = copy.splice(from, 1)
  if (moved === undefined) return [...items]
  copy.splice(to, 0, moved)
  return copy
}

/**
 * Moves an entry to the end of another day (#26): out of one, into the other, as one change. The
 * server keeps its id across days, so its history goes with it.
 */
export function moveEntryToDay(
  days: readonly DayDraft[],
  from: EntryAt,
  toDay: number,
): { readonly days: DayDraft[]; readonly at: EntryAt } {
  const entry = days[from.day]?.entries[from.entry]
  const target = days[toDay]
  if (entry === undefined || target === undefined || toDay === from.day) {
    return { days: [...days], at: from }
  }
  return {
    days: days.map((day, i) => {
      if (i === from.day) return { ...day, entries: removeAt(day.entries, from.entry) }
      if (i === toDay) return { ...day, entries: [...day.entries, entry] }
      return day
    }),
    at: { day: toDay, entry: target.entries.length },
  }
}

/**
 * An exercise picked into a day, as a new entry at its foot (#26): the plan with it, and where it
 * is — so its settings can open on it.
 */
function withEntryAdded(
  days: readonly DayDraft[],
  dayIndex: number,
  exercise: Parameters<typeof newEntry>[0],
): { readonly days: DayDraft[]; readonly at: EntryAt } {
  const day = days[dayIndex]
  if (day === undefined) return { days: [...days], at: { day: dayIndex, entry: 0 } }
  const entries = [...day.entries, keyEntry(newEntry(exercise))]
  return {
    days: replaceAt(days, dayIndex, { ...day, entries }),
    at: { day: dayIndex, entry: entries.length - 1 },
  }
}

/** Where the entry known by `key` is now — moved, or gone: null. */
export function entryAt(days: readonly DayDraft[], key: string): EntryAt | null {
  for (const [day, d] of days.entries()) {
    const entry = d.entries.findIndex((e) => e.key === key)
    if (entry !== -1) return { day, entry }
  }
  return null
}

/**
 * Exercises picked into a day together (#27), each a new entry at its foot in the order picked — the
 * plan with them, and the key of the first, whose settings open: they are set up in the order they
 * are done.
 */
export function withEntriesAdded(
  days: readonly DayDraft[],
  dayIndex: number,
  exercises: readonly Parameters<typeof newEntry>[0][],
): { readonly days: DayDraft[]; readonly first: string | null } {
  let next = [...days]
  let first: string | null = null
  for (const exercise of exercises) {
    const added = withEntryAdded(next, dayIndex, exercise)
    next = added.days
    first ??= next[added.at.day]?.entries[added.at.entry]?.key ?? null
  }
  return { days: next, first }
}
