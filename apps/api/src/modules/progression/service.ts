import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import {
  type Progression,
  type ProgressionSuggestion,
  type SessionAttempts,
  type SetAttempt,
  type SetTarget,
  nextTarget,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visible } from '../../db/ownable.ts'
import {
  exercises,
  setLogs,
  workoutDays,
  workoutEntries,
  workoutSessions,
  workoutSets,
  workouts,
} from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * How many past sessions a rule may look back over. `afterSuccesses` caps at 10, so ten is enough
 * for any rule, and it bounds the log read regardless of how long someone has been training.
 */
const HISTORY_DEPTH = 10

/**
 * Evaluates every entry in a workout against its logged history.
 *
 * The maths is `nextTarget` from `@cedo/contract` — the SAME pure function the logging screen and
 * the `progression_suggest` MCP tool use, so an AI's advice and the UI's hint can never disagree.
 * See docs/adr/0012-progression-rules.md.
 *
 * Deliberately batched: one query for the entries, one for their prescribed sets, one for the
 * caller's logs across all of them. A per-entry history query would be an N+1 that grows with the
 * size of the plan.
 */
export async function suggestForWorkout(
  caller: Caller,
  workoutId: string,
): Promise<ProgressionSuggestion[]> {
  const loaded = await loadForWorkout(caller, workoutId)
  if (loaded === null) return []
  const { entries, prescribed, logs } = loaded

  const setsByEntry = groupBy(prescribed, (s) => s.entryId)
  const logsByEntry = groupBy(
    logs.filter((l): l is typeof l & { entryId: string } => l.entryId !== null),
    (l) => l.entryId,
  )

  return entries.map((entry) =>
    suggestForEntry(entry, setsByEntry.get(entry.id) ?? [], logsByEntry.get(entry.id) ?? []),
  )
}

/** The three reads. Batched deliberately — a per-entry history query would be an N+1. */
async function loadForWorkout(caller: Caller, workoutId: string) {
  const [workout] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(visible(workouts, caller), eq(workouts.id, workoutId)))
    .limit(1)
  if (workout === undefined) throw notFound('workout')

  const entries = await db
    .select({
      id: workoutEntries.id,
      exerciseId: workoutEntries.exerciseId,
      exerciseName: exercises.name,
      progression: workoutEntries.progression,
    })
    .from(workoutEntries)
    .innerJoin(workoutDays, eq(workoutDays.id, workoutEntries.dayId))
    .innerJoin(exercises, eq(exercises.id, workoutEntries.exerciseId))
    .where(eq(workoutDays.workoutId, workoutId))
    .orderBy(asc(workoutDays.index), asc(workoutEntries.index))
  if (entries.length === 0) return null

  const entryIds = entries.map((e) => e.id)

  const prescribed = await db
    .select()
    .from(workoutSets)
    .where(inArray(workoutSets.entryId, entryIds))
    .orderBy(asc(workoutSets.index))

  return { entries, prescribed, logs: await loadLogs(caller, entryIds) }
}

/**
 * Only the CALLER's own logs. Sessions are personal, so one user's history must never influence
 * another's suggestions, even when they share the workout.
 */
async function loadLogs(caller: Caller, entryIds: string[]) {
  return await db
    .select({
      entryId: setLogs.entryId,
      sessionId: setLogs.sessionId,
      setIndex: setLogs.setIndex,
      isWarmup: setLogs.isWarmup,
      weightG: setLogs.weightG,
      reps: setLogs.reps,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
      startedAt: workoutSessions.startedAt,
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(and(eq(workoutSessions.userId, caller.userId), inArray(setLogs.entryId, entryIds)))
    .orderBy(desc(workoutSessions.startedAt), asc(setLogs.setIndex))
}

interface EntryContext {
  readonly id: string
  readonly exerciseId: string
  readonly exerciseName: string
  readonly progression: Progression
}

/** Pure apart from its inputs: all the maths is `nextTarget` from the contract. */
function suggestForEntry(
  entry: EntryContext,
  prescribed: readonly (typeof workoutSets.$inferSelect)[],
  logs: readonly LoggedSet[],
): ProgressionSuggestion {
  const working = prescribed.filter((s) => !s.isWarmup)
  const current = targetOf(working[0])
  const sessions = toSessions(logs)

  const suggested = nextTarget({
    rule: entry.progression,
    target: current,
    workingSets: working.length,
    sessions,
  })

  return {
    entryId: entry.id,
    exerciseId: entry.exerciseId,
    exerciseName: entry.exerciseName,
    rule: entry.progression,
    current,
    suggested,
    changed: !sameTarget(current, suggested),
    sessionsConsidered: sessions.length,
  }
}

/**
 * The prescription for an entry is the FIRST working set: one weight per entry, sets never diverge.
 * See docs/adr/0012-progression-rules.md.
 */
function targetOf(set: typeof workoutSets.$inferSelect | undefined): SetTarget {
  return {
    reps: set?.targetReps ?? null,
    weightG: set?.targetWeightG ?? null,
    rpe: set?.targetRpe ?? null,
    durationS: set?.targetDurationS ?? null,
    distanceMm: set?.targetDistanceMm ?? null,
  }
}

interface LoggedSet {
  readonly sessionId: string
  readonly isWarmup: boolean
  readonly weightG: number | null
  readonly reps: number | null
  readonly durationS: number | null
  readonly distanceMm: number | null
}

/** Groups flat log rows into per-session attempts, most recent session first. */
function toSessions(rows: readonly LoggedSet[]): SessionAttempts[] {
  const bySession = new Map<string, SetAttempt[]>()
  for (const row of rows) {
    const list = bySession.get(row.sessionId) ?? []
    list.push({
      weightG: row.weightG,
      reps: row.reps,
      durationS: row.durationS,
      distanceMm: row.distanceMm,
      isWarmup: row.isWarmup,
    })
    bySession.set(row.sessionId, list)
  }
  // The query already ordered by session start descending, so insertion order is newest first.
  return [...bySession.values()].slice(0, HISTORY_DEPTH)
}

const sameTarget = (a: SetTarget, b: SetTarget): boolean =>
  a.reps === b.reps &&
  a.weightG === b.weightG &&
  a.rpe === b.rpe &&
  a.durationS === b.durationS &&
  a.distanceMm === b.distanceMm

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const list = grouped.get(key(row)) ?? []
    list.push(row)
    grouped.set(key(row), list)
  }
  return grouped
}
