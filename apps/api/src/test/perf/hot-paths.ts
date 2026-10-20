import { withQueryCount } from '../../db/client.ts'
import type { PerfFixtures } from '../../db/seed-perf/index.ts'
import { resolveCaller } from '../../plugins/auth.ts'
import * as exerciseService from '../../modules/exercise/service.ts'
import * as workoutService from '../../modules/workout/service.ts'
import * as sessionService from '../../modules/session/service.ts'
import { get as getSession } from '../../modules/session/plan.ts'
import { list as listSessions } from '../../modules/session/list.ts'
import { history } from '../../modules/session/history.ts'
import { suggestForWorkout } from '../../modules/progression/service.ts'
import { trainingReview } from '../../modules/review/service.ts'
import { libraryAudit } from '../../modules/review/curation.ts'
import { type QueryPlan, explainInOrder, slowestOf } from '../explain.ts'
import type { RecordedQuery } from '../../db/client.ts'

/**
 * The paths that decide whether this is usable on cheap hardware.
 *
 * Each is measured TWICE, at two volumes of the one dimension that would produce an N+1 — page
 * size, plan size, history depth, group count. The query count must be identical. That is an
 * invariant, not a threshold: a guessed number like "fewer than 8 queries" passes a broken
 * implementation on a small fixture and fails a correct one on a large plan.
 * See docs/adr/0018-n1-detection.md and docs/10-testing.md.
 */

export type Size = 'small' | 'large'

export interface HotPath {
  readonly name: string
  /** What a regression here actually costs a user. Printed in the report. */
  readonly why: string
  /** What differs between the two runs. This is the axis the N+1 would grow along. */
  readonly dimension: string
  readonly maxQueries: number
  /**
   * A ceiling, not a target. Timings vary with the machine, so the structural assertions are the
   * real gate; this catches only a catastrophic regression such as a dropped index.
   */
  readonly budgetMs: number
  /** Tables that must never be scanned sequentially at this volume. */
  readonly noSeqScan: readonly string[]
  /**
   * Indexes that must actually appear in the plan. Existing is not the same as being used.
   *
   * Empty where more than one plan is legitimately correct — see the search path, where Postgres
   * rightly switches between the trigram index and an ordered walk depending on how selective the
   * term is. Pinning one of them would assert a planner choice, not a property of the schema.
   */
  readonly indexes: readonly string[]
  /**
   * Tables a paginated path must read in index order, never read-then-sort. Using the index is not
   * enough: an index whose order does not match the ORDER BY is still "used" to find the rows, and
   * then every matching row is sorted to return one page. See `expectNoSortOver`.
   */
  readonly ordered?: readonly string[]
  readonly run: (fixtures: PerfFixtures, size: Size) => Promise<unknown>
}

const pick = (fixtures: PerfFixtures, size: Size) =>
  size === 'small' ? fixtures.small : fixtures.large

/** Page sizes for the list paths. The caller is the same; only the number of rows differs. */
const PAGE = { small: 5, large: 50 } as const

export const HOT_PATHS: readonly HotPath[] = [
  {
    name: 'auth: resolve the caller',
    why: 'Runs on every authenticated request. Two queries here doubles the cost of the whole API.',
    dimension: 'group memberships (3 vs 52)',
    maxQueries: 1,
    budgetMs: 10,
    noSeqScan: ['sessions', 'group_members'],
    indexes: ['sessions_token_hash_idx', 'group_members_user_idx'],
    run: async (fixtures, size) => await resolveCaller(`Bearer ${pick(fixtures, size).token}`),
  },
  {
    name: 'GET /exercises (list)',
    why: 'The library screen. A per-row query here means 50 round trips to draw one page.',
    dimension: 'page size (5 vs 50)',
    maxQueries: 3,
    budgetMs: 60,
    noSeqScan: ['exercises', 'exercise_media', 'media'],
    indexes: ['exercises_name_id_idx'],
    ordered: ['exercises'],
    run: async (fixtures, size) =>
      await exerciseService.list(fixtures.large.caller, { scope: 'all', limit: PAGE[size] }),
  },
  {
    name: 'GET /exercises?scope=favourites',
    why:
      'The pinned list: the favourites join narrows 10,000 visible exercises to the few the caller ' +
      'pinned. It must find them through the favourites, not by walking the library to look.',
    dimension: 'page size (5 vs 50)',
    maxQueries: 3,
    budgetMs: 60,
    noSeqScan: ['exercises', 'exercise_favourites'],
    indexes: ['exercise_favourites_user_id_target_id_pk'],
    run: async (fixtures, size) =>
      await exerciseService.list(fixtures.large.caller, { scope: 'favourites', limit: PAGE[size] }),
  },
  {
    name: 'GET /exercises?q= (search)',
    why:
      'Substring search over 10,000 exercises. Postgres picks between the trigram index (a rare ' +
      'term) and an ordered walk it can stop early (a common one); both are correct, so only the ' +
      'absence of a sequential scan is asserted here. The trigram index has its own test.',
    dimension: 'page size (5 vs 50)',
    maxQueries: 3,
    budgetMs: 120,
    noSeqScan: ['exercises'],
    indexes: [],
    run: async (fixtures, size) =>
      await exerciseService.list(fixtures.large.caller, {
        scope: 'all',
        q: 'Bench',
        limit: PAGE[size],
      }),
  },
  {
    name: 'GET /exercises?muscle= (filter)',
    why: 'Programming around an injury filters by muscle; it must not scan the join table.',
    dimension: 'page size (5 vs 50)',
    maxQueries: 3,
    budgetMs: 120,
    noSeqScan: ['exercises', 'exercise_muscles'],
    indexes: ['exercises_name_id_idx', 'exercise_muscles_exercise_id_muscle_slug_pk'],
    run: async (fixtures, size) =>
      await exerciseService.list(fixtures.large.caller, {
        scope: 'all',
        muscle: 'pectoralis_major',
        limit: PAGE[size],
      }),
  },
  {
    name: 'GET /workouts (list)',
    why: 'The plan screen. Day counts must come from one grouped query, not one per workout.',
    dimension: 'page size (5 vs 50)',
    maxQueries: 2,
    budgetMs: 60,
    noSeqScan: ['workouts', 'workout_days'],
    indexes: ['workouts_name_id_idx', 'workout_days_order_idx'],
    ordered: ['workouts'],
    run: async (fixtures, size) =>
      await workoutService.list(fixtures.large.caller, { scope: 'all', limit: PAGE[size] }),
  },
  {
    name: 'GET /workouts/:id (full plan)',
    why: 'The classic N+1: one query per day, per entry, per set. A 14-day plan would be hundreds.',
    dimension: 'plan size (1 day / 3 entries vs 14 days / 560 entries)',
    maxQueries: 9,
    budgetMs: 120,
    noSeqScan: ['workout_days', 'workout_entries', 'workout_sets', 'exercises'],
    /**
     * Every level is read through a visible relation, a subquery Postgres must pull up for these
     * indexes to serve it. An optimisation fence in a relation — `OFFSET 0`, a LIMIT, a DISTINCT —
     * turns each level into a filtered scan of the whole table. See
     * docs/adr/0019-visible-relations.md.
     */
    indexes: ['workout_days_order_idx', 'workout_entries_order_idx', 'workout_sets_order_idx'],
    run: async (fixtures, size) => {
      const profile = pick(fixtures, size)
      return await workoutService.get(profile.caller, profile.workoutId)
    },
  },
  {
    name: 'progression suggestions',
    why: 'Evaluates every entry against its history. A per-entry history query grows with the plan.',
    dimension: 'plan size (3 vs 560 entries)',
    maxQueries: 4,
    budgetMs: 200,
    noSeqScan: ['set_logs', 'workout_sets', 'workout_entries'],
    indexes: ['workout_entries_order_idx', 'workout_sets_order_idx'],
    run: async (fixtures, size) => {
      const profile = pick(fixtures, size)
      return await suggestForWorkout(profile.caller, profile.workoutId)
    },
  },
  {
    name: 'GET /sessions (list)',
    why: 'The landing screen. Set counts and weight lifted must be one grouped query for the page.',
    dimension: 'page size (5 vs 50)',
    maxQueries: 2,
    budgetMs: 60,
    noSeqScan: ['workout_sessions', 'set_logs'],
    indexes: ['workout_sessions_user_time_idx', 'set_logs_session_idx'],
    ordered: ['workout_sessions'],
    run: async (fixtures, size) => await listSessions(fixtures.large.caller, { limit: PAGE[size] }),
  },
  {
    name: 'GET /sessions?inProgress=true',
    why: "Today's first question: is a session in progress? One, found by the index that keeps it one — not by scanning a person's history for it.",
    dimension: 'sessions the person has finished (5 vs 200)',
    maxQueries: 2,
    budgetMs: 60,
    noSeqScan: ['workout_sessions', 'set_logs'],
    indexes: ['workout_sessions_in_progress_idx'],
    run: async (fixtures, size) =>
      await listSessions(pick(fixtures, size).caller, { limit: 1, inProgress: true }),
  },
  {
    name: 'GET /sessions (next page)',
    why: 'Scrolling history. The cursor must seek into the index, not re-sort everything before it.',
    dimension: 'page size (5 vs 50)',
    // Page one to obtain a real cursor, then the page under test: two queries each.
    maxQueries: 4,
    budgetMs: 60,
    noSeqScan: ['workout_sessions', 'set_logs'],
    indexes: ['workout_sessions_user_time_idx', 'set_logs_session_idx'],
    ordered: ['workout_sessions'],
    run: async (fixtures, size) => {
      const caller = fixtures.large.caller
      const first = await listSessions(caller, { limit: PAGE[size] })
      return await listSessions(caller, {
        limit: PAGE[size],
        cursor: first.nextCursor ?? undefined,
      })
    },
  },
  {
    name: 'GET /sessions/:id',
    why: 'Read back during a live workout, with the day it follows. Must not issue one query per logged set, nor per entry of the day.',
    dimension: 'logged sets (9 vs 60), and the entries of the day followed',
    // The session and its logs; then the day, its entries, their sets, and the four exercise reads.
    maxQueries: 9,
    budgetMs: 60,
    // Its logs LEFT JOIN the plan's entries, which reach the days, and its day reads their sets.
    noSeqScan: ['set_logs', 'exercises', 'workout_entries', 'workout_days', 'workout_sets'],
    indexes: ['set_logs_session_idx'],
    run: async (fixtures, size) => {
      const profile = pick(fixtures, size)
      return await getSession(profile.caller, profile.sessionId)
    },
  },
  {
    name: 'GET /exercises/:id/history',
    why: 'Reads the largest table in the system, and is what a progress chart will consume.',
    dimension: 'logs for the exercise (tens vs tens of thousands)',
    maxQueries: 2,
    budgetMs: 80,
    noSeqScan: ['set_logs', 'workout_sessions'],
    indexes: ['workout_sessions_user_time_idx', 'set_logs_session_idx'],
    run: async (fixtures, size) => {
      const profile = pick(fixtures, size)
      return await history(profile.caller, profile.exerciseId, { limit: 20 })
    },
  },
  {
    name: 'POST /sessions/:id/logs (write)',
    why:
      'The one write a user repeats dozens of times an hour, mid-workout, on a phone. It is also ' +
      'the only guarded path that mutates, so its plans are read without ANALYZE.',
    dimension: 'sets already logged in the session (9 vs 60)',
    // Four, plus reading the set's series under the lock to number it — its logs LEFT JOINed onto
    // the plan entries the caller can still reach, in the same query.
    maxQueries: 5,
    budgetMs: 40,
    noSeqScan: ['workout_sessions', 'set_logs', 'workout_entries', 'workout_days'],
    indexes: [],
    run: async (fixtures, size) => {
      const profile = pick(fixtures, size)
      return await sessionService.logSet(profile.caller, profile.openSessionId, {
        exerciseId: profile.exerciseId,
        entryId: null,
        weightG: 60_000,
        reps: 8,
        rpe: null,
        durationS: null,
        distanceMm: null,
        isWarmup: false,
      })
    },
  },
  {
    name: 'training review',
    why: 'The MCP review tool. It aggregates a whole training block and is the slowest read here.',
    dimension: 'sessions in the window (5 vs 200)',
    maxQueries: 5,
    budgetMs: 400,
    noSeqScan: ['set_logs', 'workout_sessions'],
    indexes: ['workout_sessions_user_time_idx', 'set_logs_session_idx'],
    run: async (fixtures, size) => {
      const profile = pick(fixtures, size)
      return await trainingReview(profile.caller, 8)
    },
  },
  {
    name: 'library audit',
    why:
      'A curator auditing a 10,000-exercise library of distinct names (seed-perf/curated.ts). Each ' +
      'candidate looks up its near-duplicates through the trigram index. With a per-candidate ' +
      'LIMIT the planner bet on walking the library in name order instead — 23s here — and at ' +
      "pg_trgm's default threshold the index handed back every loose match: 1s against 0.28s.",
    dimension: 'none — one library, so both runs must issue the same statements',
    maxQueries: 6,
    budgetMs: 700,
    noSeqScan: ['exercises'],
    indexes: ['exercises_name_trgm_idx'],
    run: async (fixtures) => await libraryAudit(fixtures.curator, fixtures.curator.personalGroupId),
  },
]

export interface Measurement {
  readonly path: HotPath
  readonly smallCount: number
  readonly largeCount: number
  readonly statements: readonly RecordedQuery[]
  readonly plans: readonly QueryPlan[]
  readonly slowestMs: number
}

/**
 * Runs both sizes and explains the LARGE run's statements — the small one exists only to make the
 * query count comparable, and its plans are the ones nobody is at risk from.
 */
export async function measure(path: HotPath, fixtures: PerfFixtures): Promise<Measurement> {
  /**
   * Warmed first so the measurement is not dominated by the first connection and plan cache miss.
   *
   * This means a write path runs three times per measurement. That is deliberate and harmless — the
   * rows it adds are the same shape as the seed's — but it is why no write path may assert on row
   * counts, and why `explain` never runs a write under ANALYZE.
   */
  await path.run(fixtures, 'small')

  const small = await withQueryCount(async () => await path.run(fixtures, 'small'))
  const large = await withQueryCount(async () => await path.run(fixtures, 'large'))

  // Explained once, and the budget read off the same plans: a second pass would re-run every
  // statement under ANALYZE, doubling both the work and the writes on a write path.
  const plans = await explainInOrder(large.statements)

  return {
    path,
    smallCount: small.count,
    largeCount: large.count,
    statements: large.statements,
    plans,
    slowestMs: slowestOf(plans),
  }
}
