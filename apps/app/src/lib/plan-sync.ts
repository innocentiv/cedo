import type { Workout } from '@cedo/contract'
import { ApiError } from '../api/errors.ts'
import { type DayDraft, draftFrom } from './plan-draft.ts'

/**
 * When a plan edited in place is saved, and what the page shows meanwhile (#26, ADR-0022). App-owned
 * state with no React in it, unit-tested beside it.
 *
 * - Every change is saved as it is made — once the plan is one the schema accepts.
 * - **One save at a time.** A change made while one is on its way waits for it, and then the plan as
 *   it stands is sent: the changes arrive in the order made, the last one last.
 * - Each save carries the version it was made from; the server answers with the next.
 * - The ids the server gives new days and entries are learned from its answer, by position — the
 *   answer is the plan sent, in the order sent — and carried into the page's copy by key.
 * - A refused save puts the page back to the plan as last saved, and says why. A conflict — the
 *   plan saved elsewhere since — is the hook's to answer, by reading it again (`reloaded`).
 */

export interface PlanSync {
  /** What the page shows: every change, saved or not. */
  readonly days: readonly DayDraft[]
  /** The plan as the server last confirmed it: what a refusal goes back to. */
  readonly saved: readonly DayDraft[]
  readonly version: number
  /** The plan on its way to the server; null when none is. */
  readonly sending: readonly DayDraft[] | null
  /** Why the plan on screen is not the one stored, said until the next change. */
  readonly said: string | null
}

export type SyncEvent =
  | { readonly kind: 'edit'; readonly days: readonly DayDraft[] }
  | { readonly kind: 'saved'; readonly workout: Workout }
  | { readonly kind: 'refused'; readonly reason: string }
  /** Read again after a conflict: what is stored replaces the page's copy, and says so. */
  | { readonly kind: 'reloaded'; readonly workout: Workout; readonly reason: string }
  /** The workout as last read. Taken only when it is newer and nothing here is unsaved. */
  | { readonly kind: 'fetched'; readonly workout: Workout }

export interface Step {
  readonly state: PlanSync
  /** A plan to send now, with `state.version`; null when nothing is to be sent. */
  readonly send: readonly DayDraft[] | null
}

export const startSync = (workout: Workout): PlanSync => {
  const days = draftFrom(workout)
  return { days, saved: days, version: workout.version, sending: null, said: null }
}

/** Whether the page holds a change the server does not have yet — on its way, or waiting. */
export const unsaved = (sync: PlanSync): boolean =>
  sync.sending !== null || sync.days !== sync.saved

/**
 * One event, and what to send because of it. `accepts` is the schema's verdict on a plan
 * (`planIssues`): a plan it would refuse is kept on screen, and not sent.
 */
export function step(
  sync: PlanSync,
  event: SyncEvent,
  accepts: (days: readonly DayDraft[]) => boolean,
): Step {
  const sendIfReady = (state: PlanSync): Step =>
    state.sending === null && state.days !== state.saved && accepts(state.days)
      ? { state: { ...state, sending: state.days }, send: state.days }
      : { state, send: null }

  switch (event.kind) {
    case 'edit':
      return sendIfReady({ ...sync, days: event.days, said: null })
    case 'saved': {
      const sent = sync.sending ?? sync.days
      const ids = idsLearned(sent, event.workout)
      // Unchanged since it was sent: the server's answer is the page's copy, ids and all.
      const changedSince = sync.days !== sent
      const saved = withIds(sent, ids)
      return sendIfReady({
        ...sync,
        saved,
        days: changedSince ? withIds(sync.days, ids) : saved,
        version: event.workout.version,
        sending: null,
      })
    }
    case 'refused':
      return { state: { ...sync, days: sync.saved, sending: null, said: event.reason }, send: null }
    case 'reloaded':
      return { state: { ...startSync(event.workout), said: event.reason }, send: null }
    case 'fetched':
      return event.workout.version > sync.version && !unsaved(sync)
        ? { state: startSync(event.workout), send: null }
        : { state: sync, send: null }
    default:
      return { state: sync, send: null }
  }
}

/**
 * The ids the server gave what was sent, by key: its answer is the plan sent, day by day and entry
 * by entry in the order sent — so position says which is which, new ones included, and an entry
 * whose exercise changed (a new entry to the server) takes its new id.
 */
export function idsLearned(sent: readonly DayDraft[], saved: Workout): Map<string, string> {
  const ids = new Map<string, string>()
  sent.forEach((day, d) => {
    const savedDay = saved.days[d]
    if (savedDay === undefined) return
    ids.set(day.key, savedDay.id)
    day.entries.forEach((entry, e) => {
      const savedEntry = savedDay.entries[e]
      if (savedEntry !== undefined) ids.set(entry.key, savedEntry.id)
    })
  })
  return ids
}

/** The page's copy with every id learned, each day and entry still known by the same key. */
export const withIds = (days: readonly DayDraft[], ids: ReadonlyMap<string, string>): DayDraft[] =>
  days.map((day) => ({
    ...day,
    id: ids.get(day.key) ?? day.id,
    entries: day.entries.map((entry) => ({ ...entry, id: ids.get(entry.key) ?? entry.id })),
  }))

/** What a save made from an older copy is said to have done, on the page that made it. */
export const RELOADED = 'Changed elsewhere since it was opened — this is the plan as saved there.'

/**
 * One save, and what came of it: saved; refused, with the server's reason; or — saved elsewhere
 * since (409) — the plan as it is now, read again. Refused when even that read fails: the page puts
 * back the plan as last saved, and is free to send the next change, which the server answers again.
 */
export async function saveOutcome(
  save: () => Promise<Workout>,
  reread: () => Promise<Workout | null>,
): Promise<SyncEvent> {
  try {
    return { kind: 'saved', workout: await save() }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const fresh = await reread()
      return fresh === null
        ? { kind: 'refused', reason: error.message }
        : { kind: 'reloaded', workout: fresh, reason: RELOADED }
    }
    return { kind: 'refused', reason: error instanceof Error ? error.message : 'Not saved' }
  }
}
