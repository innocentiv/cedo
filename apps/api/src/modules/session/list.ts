import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Page, SessionQuery, WorkoutSessionSummary } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visible } from '../../db/ownable.ts'
import { setLogs, workoutDays, workoutSessions, workouts } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { decodeCursor, encodeCursor } from './cursor.ts'
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
   * The id tiebreaker is load-bearing. A bare `started_at <` cursor built from an ISO string is
   * truncated to milliseconds while the column holds microseconds, so page 2 silently skipped every
   * session inside the truncated millisecond — and two sessions in the same millisecond (easy
   * through MCP `session_log`) lost one permanently.
   */
  const after = decodeCursor(query.cursor)
  if (after !== null) {
    conditions.push(
      sql`(${workoutSessions.startedAt}, ${workoutSessions.id}) < (${after.startedAt}, ${after.id})`,
    )
  }

  return await db
    .select({ session: workoutSessions, workoutName: workouts.name, dayName: workoutDays.name })
    .from(workoutSessions)
    /**
     * `visible()` is in the JOIN condition, not the WHERE: the session is the caller's own and must
     * always be listed, but the workout it points at may have become unreachable since — a shared
     * group they were removed from still leaves their sessions behind, referencing it. Gating the
     * join yields `workoutName: null` instead of dropping the session or naming something they can
     * no longer open. `WorkoutSessionSummary` already types both names as nullable.
     *
     * The day inherits the workout's visibility by joining through it, because that is the actual
     * rule — a day is readable exactly when its workout is. See docs/03-domain-model.md.
     */
    .leftJoin(workouts, and(eq(workouts.id, workoutSessions.workoutId), visible(workouts, caller)))
    .leftJoin(
      workoutDays,
      and(eq(workoutDays.id, workoutSessions.dayId), eq(workoutDays.workoutId, workouts.id)),
    )
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

  const totalBySession = await totalsFor(items.map((r) => r.session.id))

  return {
    items: items.map((r) => toSummary(r, totalBySession.get(r.session.id))),
    nextCursor: hasMore ? encodeCursor(items.at(-1)?.session) : null,
  }
}

interface SummaryRow {
  readonly session: SessionRow
  readonly workoutName: string | null
  readonly dayName: string | null
}

function toSummary(
  r: SummaryRow,
  total: { sets: number; volume: number } | undefined,
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
    totalVolumeG: total?.volume ?? 0,
  }
}

/**
 * Set counts and volume for a whole page in ONE grouped query, never one per session. Warm-ups are
 * excluded from both — they are not work performed. See docs/adr/0012-progression-rules.md.
 */
async function totalsFor(sessionIds: string[]) {
  if (sessionIds.length === 0) return new Map<string, { sets: number; volume: number }>()

  const totals = await db
    .select({
      sessionId: setLogs.sessionId,
      sets: sql<number>`count(*) filter (where not ${setLogs.isWarmup})`.mapWith(Number),
      volume:
        sql<number>`coalesce(sum(${setLogs.weightG} * ${setLogs.reps}) filter (where not ${setLogs.isWarmup}), 0)`.mapWith(
          Number,
        ),
    })
    .from(setLogs)
    .where(inArray(setLogs.sessionId, sessionIds))
    .groupBy(setLogs.sessionId)

  return new Map(totals.map((t) => [t.sessionId, { sets: t.sets, volume: t.volume }]))
}
