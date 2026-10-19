import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Page, SessionQuery, WorkoutSessionSummary } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleWorkoutDays, visibleWorkouts } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { afterCursor, cursorMicros, decodeCursor, encodeCursor } from './cursor.ts'
import { ownedBy, type SessionRow } from './service.ts'

/**
 * `GET /sessions` — the landing screen's query, and the one read that must survive losing access to
 * what it points at. See docs/06-api.md.
 */

/**
 * The page itself. Split from `list` because the joins carry the interesting decision and the
 * folding afterwards is bookkeeping.
 */
async function page(caller: Caller, query: SessionQuery) {
  const conditions = [ownedBy(caller)]
  if (query.workoutId !== undefined) conditions.push(eq(workoutSessions.workoutId, query.workoutId))
  if (query.since !== undefined)
    conditions.push(sql`${workoutSessions.startedAt} >= ${query.since}`)
  /**
   * Keyset on (started_at, id) descending, which is exactly workout_sessions_user_time_idx —
   * including the id column, so the index serves the ordering and the walk stops at the page size.
   *
   * The id tiebreaker orders sessions with an identical `started_at`; it does NOT rescue a cursor
   * that has lost precision. A millisecond cursor sits below every session in its own millisecond,
   * so they were all skipped regardless of id. The cursor is exact to the microsecond — see
   * `cursor.ts`.
   */
  const after = decodeCursor(query.cursor)
  if (after !== null) conditions.push(afterCursor(after))

  const workouts = visibleWorkouts(caller)
  const days = visibleWorkoutDays(caller)
  return await db
    .select({
      session: workoutSessions,
      workoutName: workouts.name,
      dayName: days.name,
      micros: cursorMicros,
    })
    .from(workoutSessions)
    /**
     * LEFT joins onto the visible relations: the session is the caller's own and must always be
     * listed, but the workout it points at may have become unreachable since — a shared group they
     * were removed from still leaves their sessions behind, referencing it. The left join yields
     * `workoutName: null` instead of dropping the session or naming something they can no longer
     * open. `WorkoutSessionSummary` already types both names as nullable.
     *
     * A day carries its workout's owner, so it is readable exactly when its workout is, with no
     * join through the workout. See docs/03-domain-model.md.
     */
    .leftJoin(workouts, eq(workouts.id, workoutSessions.workoutId))
    .leftJoin(days, eq(days.id, workoutSessions.dayId))
    .where(and(...conditions))
    .orderBy(desc(workoutSessions.startedAt), desc(workoutSessions.id))
    .limit(query.limit + 1)
}

export async function list(
  caller: Caller,
  query: SessionQuery,
): Promise<Page<WorkoutSessionSummary>> {
  const rows = await page(caller, query)

  const hasMore = rows.length > query.limit
  const items = rows.slice(0, query.limit)
  const last = items.at(-1)

  const totalBySession = await totalsFor(items.map((r) => r.session.id))

  return {
    items: items.map((r) => toSummary(r, totalBySession.get(r.session.id))),
    nextCursor:
      hasMore && last !== undefined
        ? encodeCursor({ micros: last.micros, id: last.session.id })
        : null,
  }
}

interface SummaryRow {
  readonly session: SessionRow
  readonly workoutName: string | null
  readonly dayName: string | null
}

function toSummary(
  r: SummaryRow,
  total: { sets: number; lifted: number } | undefined,
): WorkoutSessionSummary {
  return {
    id: r.session.id,
    workoutId: r.session.workoutId,
    dayId: r.session.dayId,
    startedAt: r.session.startedAt.toISOString(),
    endedAt: r.session.endedAt?.toISOString() ?? null,
    notes: r.session.notes,
    workoutName: r.workoutName,
    dayName: r.dayName,
    setCount: total?.sets ?? 0,
    liftedG: total?.lifted ?? 0,
  }
}

/**
 * Set counts and weight lifted for a whole page in ONE grouped query, never one per session.
 * Warm-ups are excluded from both — they are not work performed. See
 * docs/adr/0012-progression-rules.md.
 */
async function totalsFor(sessionIds: string[]) {
  if (sessionIds.length === 0) return new Map<string, { sets: number; lifted: number }>()

  const totals = await db
    .select({
      sessionId: setLogs.sessionId,
      sets: sql<number>`count(*) filter (where not ${setLogs.isWarmup})`.mapWith(Number),
      lifted:
        // `::bigint` for the same reason as the review's weight-lifted sum: weight × reps overflows
        // int4 at loads the contract permits. See modules/review/service.ts.
        sql<number>`coalesce(sum(${setLogs.weightG}::bigint * ${setLogs.reps}) filter (where not ${setLogs.isWarmup}), 0)`.mapWith(
          Number,
        ),
    })
    .from(setLogs)
    .where(inArray(setLogs.sessionId, sessionIds))
    .groupBy(setLogs.sessionId)

  return new Map(totals.map((t) => [t.sessionId, { sets: t.sets, lifted: t.lifted }]))
}
