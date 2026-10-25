import type { SetLog } from './log.ts'
import { NO_TARGET, type SetTarget } from './progression.ts'
import { DEFAULT_REST_S, type Rest } from './rest.ts'
import type { WorkoutSet } from './workout.ts'

/**
 * How a session moves through its day (#24): each entry's sets as done and still to do, which
 * entry has the focus, and whose rest is running. Pure, so the workout screen only renders it. See
 * docs/08-frontend.md, "The workout screen".
 */

/** What these rules read of an entry: a `SessionEntry` is one. */
export interface FlowEntry {
  readonly id: string
  readonly index: number
  readonly supersetGroup: string | null
  readonly sets: readonly Pick<WorkoutSet, 'index' | 'isWarmup' | 'target'>[]
  /** Null when the reader cannot see it: nothing can be logged against it, so it is never next. */
  readonly exercise: object | null
}

/** What they read of a set logged: a `SetLog` is one. */
export type FlowLog = Pick<
  SetLog,
  'id' | 'entryId' | 'isWarmup' | 'loggedAt' | 'reps' | 'weightG' | 'durationS' | 'distanceMm'
>

/** One set of an entry as the session sees it: what the plan asks of it, and its log once done. */
export interface SessionSet<L extends FlowLog = SetLog> {
  /** Stable within the entry: `w0`, `w1` for warm-ups, `s0`… for working sets, `x0`… beyond. */
  readonly key: string
  readonly isWarmup: boolean
  /** What to do: a warm-up's own target, or — for a working set — what this session asks. */
  readonly target: SetTarget
  /** The set as logged, or null while it is still to do. */
  readonly log: L | null
  /** Logged beyond what the plan prescribes ("+ set"). */
  readonly extra: boolean
}

/**
 * An entry's sets, warm-ups first, each paired with its log: the nth warm-up logged against the
 * entry is its nth warm-up, the nth working set its nth working set — counted, as `done` is, in
 * the entry's own series. Working sets logged beyond the prescription follow as extra.
 *
 * `working` is what this session asks of a working set (`EntryTarget.target`); without one — an
 * exercise out of reach — the plan's own prescription is shown.
 */
export function setsOf<L extends FlowLog>(
  entry: Pick<FlowEntry, 'id' | 'sets'>,
  logs: readonly L[],
  working: SetTarget | null,
): SessionSet<L>[] {
  const mine = logs.filter((l) => l.entryId === entry.id)
  const warmLogs = mine.filter((l) => l.isWarmup)
  const workLogs = mine.filter((l) => !l.isWarmup)
  const planned = entry.sets.toSorted((a, b) => a.index - b.index)
  const warmups = planned.filter((s) => s.isWarmup)
  const workingSets = planned.filter((s) => !s.isWarmup)
  const workingTarget = working ?? workingSets[0]?.target ?? null

  const sets: SessionSet<L>[] = [
    ...warmups.map((s, i) => ({
      key: `w${i}`,
      isWarmup: true,
      target: s.target,
      log: warmLogs[i] ?? null,
      extra: false,
    })),
    ...workingSets.map((s, i) => ({
      key: `s${i}`,
      isWarmup: false,
      target: workingTarget ?? s.target,
      log: workLogs[i] ?? null,
      extra: false,
    })),
  ]
  const beyond = workLogs.slice(workingSets.length)
  return [
    ...sets,
    ...beyond.map((log, i) => ({
      key: `x${i}`,
      isWarmup: false,
      target: workingTarget ?? effortOf(log),
      log,
      extra: true,
    })),
  ]
}

/** The first set still to do, or null when every prescribed set is logged. */
export const nextSet = <L extends FlowLog>(sets: readonly SessionSet<L>[]): SessionSet<L> | null =>
  sets.find((s) => s.log === null) ?? null

const effortOf = (log: FlowLog): SetTarget => ({
  reps: log.reps,
  weightG: log.weightG,
  rpe: null,
  durationS: log.durationS,
  distanceMm: log.distanceMm,
})

/** Whether every prescribed set of an entry is logged. */
const complete = (entry: FlowEntry, logs: readonly FlowLog[]): boolean =>
  nextSet(setsOf(entry, logs, null)) === null

const latestOfDay = (entries: readonly FlowEntry[], logs: readonly FlowLog[]): FlowLog | null =>
  logs
    .filter((l) => entries.some((e) => e.id === l.entryId))
    .reduce<FlowLog | null>(
      (latest, l) => (latest === null || l.loggedAt >= latest.loggedAt ? l : latest),
      null,
    )

/**
 * The entry the session is on, by what was logged last:
 *
 * - in a superset, the next entry of its letter, in day order and round again, that has sets left —
 *   so the pair alternates;
 * - otherwise the same entry, while it has sets left;
 * - otherwise the first entry of the day with sets left.
 *
 * Null once every prescribed set of the day is logged. An entry the athlete chose by tapping it is
 * the screen's to hold until the next set is logged, after which this takes over again.
 */
export function focusOf<E extends FlowEntry>(
  day: { readonly entries: readonly E[] },
  logs: readonly FlowLog[],
): E | null {
  const open = day.entries.filter((e) => e.exercise !== null && !complete(e, logs))
  if (open.length === 0) return null
  const latest = latestOfDay(day.entries, logs)
  const last = day.entries.find((e) => e.id === latest?.entryId)
  if (last !== undefined && last.supersetGroup !== null) {
    const group = day.entries.filter((e) => e.supersetGroup === last.supersetGroup)
    const from = group.findIndex((e) => e.id === last.id)
    const rotated = [...group.slice(from + 1), ...group.slice(0, from + 1)]
    const partner = rotated.find((e) => open.includes(e))
    if (partner !== undefined) return partner
  }
  if (last !== undefined && open.includes(last)) return last
  return open[0] ?? null
}

/**
 * The entry whose rest is running: the one of the working set logged last — unless that set was in
 * a superset and the focus moves on to a partner LATER in the day, which is done straight on. Back
 * round to the first of the letter is the round done, and the rest runs. Null before a working set
 * is logged. The time left is `restLeft`'s to count.
 */
export function restingAfter<E extends FlowEntry>(
  day: { readonly entries: readonly E[] },
  logs: readonly FlowLog[],
): E | null {
  const latest = latestOfDay(day.entries, logs)
  const last = day.entries.find((e) => e.id === latest?.entryId)
  if (last === undefined || latest?.isWarmup === true) return null
  const focus = focusOf(day, logs)
  const midRound =
    last.supersetGroup !== null &&
    focus !== null &&
    focus.supersetGroup === last.supersetGroup &&
    focus.index > last.index
  return midRound ? null : last
}

/**
 * Whole seconds from `startedAt` to `until` (epoch ms) — a session's clock, never below zero: the
 * server dated its start, the device reads the time, and the two disagree by a moment or more.
 */
export const elapsedS = (startedAt: string, until: number): number =>
  Math.max(0, Math.floor((until - Date.parse(startedAt)) / 1000))

/** What a finished session comes to — its summary at the end, and its row in history. */
export interface SessionSummary<
  L extends { readonly isWarmup: boolean; readonly personalBest: boolean },
> {
  /** From start to finish in whole seconds; null while it is in progress. */
  readonly durationS: number | null
  readonly workingSets: number
  /** The sets that were personal bests, in the order done. */
  readonly personalBests: readonly L[]
}

export function sessionSummary<
  L extends { readonly isWarmup: boolean; readonly personalBest: boolean },
>(session: {
  readonly startedAt: string
  readonly endedAt: string | null
  readonly logs: readonly L[]
}): SessionSummary<L> {
  return {
    durationS:
      session.endedAt === null ? null : elapsedS(session.startedAt, Date.parse(session.endedAt)),
    workingSets: session.logs.filter((l) => !l.isWarmup).length,
    personalBests: session.logs.filter((l) => l.personalBest),
  }
}

/**
 * An exercise of a session without a plan, as sets: what was logged of it, then one more to do,
 * starting from the last — or from nothing, the first time. Nothing is prescribed, so there is
 * always a next set, until the athlete moves on.
 */
export function adHocSetsOf<L extends FlowLog & { readonly exerciseId: string }>(
  exerciseId: string,
  logs: readonly L[],
): SessionSet<L>[] {
  const done = logs.filter((l) => l.entryId === null && l.exerciseId === exerciseId)
  const last = done.at(-1)
  return [
    ...done.map((log, i) => ({
      key: `s${i}`,
      isWarmup: log.isWarmup,
      target: effortOf(log),
      log,
      extra: false,
    })),
    {
      key: `s${done.length}`,
      isWarmup: false,
      target: last === undefined ? NO_TARGET : effortOf(last),
      log: null,
      extra: false,
    },
  ]
}

/**
 * The rest running after the working set logged last, as a `Rest` — or null when none runs: before
 * a working set, after a warm-up, within a superset round (`restingAfter`), or with no rest
 * prescribed. A set logged with no plan entry — a session without a plan, or a swap in one — rests
 * the default two minutes, there being no entry to say otherwise.
 */
export function restOf(
  day: {
    readonly entries: readonly (FlowEntry & { readonly restSeconds: number | null })[]
  } | null,
  logs: readonly FlowLog[],
): Rest | null {
  const latest = logs.reduce<FlowLog | null>(
    (last, l) => (last === null || l.loggedAt >= last.loggedAt ? l : last),
    null,
  )
  if (latest === null || latest.isWarmup) return null
  if (latest.entryId === null) return { since: latest.loggedAt, seconds: DEFAULT_REST_S }
  if (day === null) return null
  const entry = restingAfter(day, logs)
  if (entry === null || entry.restSeconds === null || entry.restSeconds === 0) return null
  const since = logs
    .filter((l) => l.entryId === entry.id && !l.isWarmup)
    .reduce((at, l) => (l.loggedAt > at ? l.loggedAt : at), '')
  return since === '' ? null : { since, seconds: entry.restSeconds }
}
