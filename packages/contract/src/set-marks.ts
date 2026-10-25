import { asksReserve } from './dimension.ts'
import type { TrackingMode } from './exercise.ts'
import { type SeriesMember, sameSeries } from './log.ts'
import { type FlowLog, type SessionSet, nextSet } from './session-flow.ts'

/**
 * How the workout screen names and marks a session's sets (#24): each set's mark and label, how far
 * along an entry is, what the next set and a logged one are called. The flow they read is
 * `session-flow.ts`; these only say it.
 */

/** How a set shows on the workout screen. */
export type SetMark = 'todo' | 'next' | 'done' | 'best' | 'waiting'

/**
 * A set's mark: logged and the server's — done, or a personal best; logged and still waiting for a
 * signal (`waiting`, the ids of sets not yet sent); not logged — the next one, or to do.
 */
export function markOf<L extends FlowLog>(
  set: SessionSet<L>,
  next: SessionSet<L> | null,
  waiting: ReadonlySet<string>,
): SetMark {
  if (set.log === null) return set.key === next?.key ? 'next' : 'todo'
  if (waiting.has(set.log.id)) return 'waiting'
  return 'personalBest' in set.log && set.log.personalBest === true ? 'best' : 'done'
}

/**
 * What the next set is called, and what logging it is called: "Warm-up 1 of 2" / "Log warm-up",
 * "Set 3 of 5" / "Log set 3" — or, once every prescribed set is logged, "Another set". Without a
 * plan there is no "of": nothing was prescribed.
 */
export function nextSetWords(
  sets: readonly Pick<SessionSet<FlowLog>, 'key' | 'isWarmup' | 'log' | 'extra'>[],
  next: Pick<SessionSet<FlowLog>, 'key' | 'isWarmup'> | null,
  prescribed: boolean,
): { readonly title: string; readonly action: string } {
  if (next === null) return { title: 'Another set', action: 'Log another set' }
  const kind = sets.filter((s) => s.isWarmup === next.isWarmup && !s.extra)
  const n = kind.findIndex((s) => s.key === next.key) + 1
  if (next.isWarmup) {
    return { title: `Warm-up ${n} of ${kind.length}`, action: 'Log warm-up' }
  }
  return {
    title: prescribed ? `Set ${n} of ${kind.length}` : `Set ${n}`,
    action: `Log set ${n}`,
  }
}

/** A set as the workout screen marks it: its key, kind, mark and label — W, or its number. */
export interface MarkedSet {
  readonly key: string
  readonly isWarmup: boolean
  readonly mark: SetMark
  readonly label: string
}

export function markedSets<L extends FlowLog>(
  sets: readonly SessionSet<L>[],
  waiting: ReadonlySet<string>,
): MarkedSet[] {
  const next = nextSet(sets)
  const working = sets.filter((s) => !s.isWarmup)
  return sets.map((s) => ({
    key: s.key,
    isWarmup: s.isWarmup,
    mark: markOf(s, next, waiting),
    label: s.isWarmup ? 'W' : String(working.indexOf(s) + 1),
  }))
}

/**
 * How far along an entry is: working sets logged, of those prescribed — "2 of 3"; without a plan,
 * nothing was prescribed — "2 done".
 */
export function progressOf(sets: readonly SessionSet<FlowLog>[], prescribed = true): string {
  const working = sets.filter((s) => !s.isWarmup)
  const done = working.filter((s) => s.log !== null).length
  if (!prescribed) return `${done} done`
  const of = working.filter((s) => !s.extra).length
  return `${done} of ${of}`
}

/** Whether a logged set is asked its reserve: a working set, of an exercise counted in reps. */
export const asksReserveOf = (
  set: { readonly isWarmup: boolean },
  tracking: TrackingMode,
): boolean => !set.isWarmup && asksReserve(tracking)

/**
 * A day's entries in the runs they are done in: each alone, or the entries of a superset together —
 * consecutive entries sharing a letter, as a plan orders them.
 */
export function bySuperset<T extends { readonly superset: string | null }>(
  items: readonly T[],
): T[][] {
  const runs: T[][] = []
  for (const item of items) {
    const last = runs.at(-1)
    if (item.superset !== null && last?.[0]?.superset === item.superset) last.push(item)
    else runs.push([item])
  }
  return runs
}

/**
 * What a logged set is called where an athlete reads it: "warm-up", or "set N" counting the working
 * sets of its series alone — the server numbers a series warm-ups included (GLOSSARY.md, "Series"),
 * which read the first working set after two warm-ups as "set 3". As the marks number them.
 */
export function loggedLabel<
  L extends SeriesMember & { readonly id: string; readonly isWarmup: boolean },
>(log: L, logs: readonly L[]): string {
  if (log.isWarmup) return 'warm-up'
  const working = logs.filter((l) => !l.isWarmup && sameSeries(l, log))
  return `set ${working.findIndex((l) => l.id === log.id) + 1}`
}

/** `Warm-up`, `Set 2`: a logged set's name standing alone, as a row of its exercise's sets (#25). */
export function loggedTitle<
  L extends SeriesMember & { readonly id: string; readonly isWarmup: boolean },
>(log: L, logs: readonly L[]): string {
  const label = loggedLabel(log, logs)
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}
