import { type SQL, type SQLWrapper, eq, getTableColumns, sql } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { type Training, sessionsOf } from '../coaching/training.ts'

/**
 * The sets of a training: every set logged in the athlete's sessions, each with its session's start
 * and end, as a relation to select from or join onto — the only way outside `session/` to read the
 * sets, which the lint fences to it (docs/02-conventions.md). Whose they are is said here once, by
 * `sessionsOf`: the review, progression, history and bests each used to write the join and say it
 * for themselves, three different ways.
 *
 * An aliased subquery, `(select set_logs.*, started_at, ended_at from set_logs join workout_sessions
 * … where user_id = …) as sets_of`, which Postgres pulls up into the outer query: its plans are the
 * ones the raw join gets, indexes included, as for the visible relations (db/visible.ts). `bun run
 * perf` holds that. A subquery's own ORDER BY is not kept, so each reader orders what it reads.
 *
 * Warm-ups are in it, marked: some readers want them (history, the order a session was done in),
 * most filter them out. Writes do not go through here; they are `set-writes.ts`'s.
 */

const qb = new QueryBuilder()

export const setsOf = (training: Training) =>
  qb
    .select({
      ...getTableColumns(setLogs),
      startedAt: workoutSessions.startedAt,
      endedAt: workoutSessions.endedAt,
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(sessionsOf(training))
    .as('sets_of')

/**
 * What a set lifted: its weight times its reps — of the sets of a training, or of `set_logs` read by
 * session in `session/` itself. Said once, for the review's work per muscle and a session's total.
 *
 * `::bigint` on the first factor, so what is made of it does not overflow int4: the review's share
 * of a muscle, 500 kg × 50 reps × 100%, is 2.5e9 against a 2.147e9 ceiling, every factor inside what
 * the contract allows, and Postgres raises `integer out of range` rather than round. `greatest(…, 0)`: negative added weight is assistance (#19) — help,
 * not load, so it lifts nothing. A bigint arrives from the driver as a string: sum it, and read the
 * sum with `.mapWith(Number)`.
 */
export const liftedOf = (sets: {
  readonly weightG: SQLWrapper
  readonly reps: SQLWrapper
}): SQL<number> => sql<number>`greatest(${sets.weightG}, 0)::bigint * ${sets.reps}`
