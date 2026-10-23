import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { exercises } from './exercise.ts'
import { rpeCheck, rpeColumn } from './rpe.ts'
import { users } from './identity.ts'
import { workoutDays, workoutEntries, workouts } from './workout.ts'

/**
 * What actually happened. Sessions belong to a user directly, NOT via `ownable()`: logs are
 * personal and are never shared, favourited or transferred.
 *
 * `workoutId`, `dayId` and `entryId` are nullable so ad-hoc training — walking in and lifting with
 * no plan — uses the same tables and feeds the same history.
 */
export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workoutId: uuid('workout_id').references(() => workouts.id, { onDelete: 'set null' }),
    dayId: uuid('day_id').references(() => workoutDays.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => [
    /**
     * The session list, newest first — the landing screen's query.
     *
     * `id` is in the index because the keyset cursor is a ROW comparison on
     * (started_at, id) descending: without the third column Postgres can use the index to find the
     * rows but not to order them, so it read every session the user owns and sorted them on every
     * page. See docs/10-testing.md.
     *
     * `.nullsFirst()` is load-bearing although neither column can be null. Drizzle's `.desc()`
     * emits DESC NULLS LAST, while SQL's `ORDER BY … DESC` means NULLS FIRST; the planner does not
     * reconcile the two from a NOT NULL constraint, so the index found the rows and then a Sort
     * re-read all of them — the exact problem the `id` column was added to fix. The perf suite's
     * `ordered` assertion now fails on it.
     */
    index('workout_sessions_user_time_idx').on(
      t.userId,
      t.startedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('workout_sessions_workout_idx').on(t.workoutId),
    /**
     * One session in progress per person — the database's own rule, so two starts arriving
     * together cannot both win, as a check-then-insert lets them. Also what the session in progress
     * is found by (`inProgress`). See GLOSSARY.md, "Session".
     */
    uniqueIndex('workout_sessions_in_progress_idx')
      .on(t.userId)
      .where(sql`${t.endedAt} is null`),
  ],
)

export const setLogs = pgTable(
  'set_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    /** The prescribed set this fulfils. Null for ad-hoc work. */
    entryId: uuid('entry_id').references(() => workoutEntries.id, { onDelete: 'set null' }),
    /** Always set, even ad hoc — this is what makes per-exercise history one indexed read. */
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    setIndex: smallint('set_index').notNull(),
    isWarmup: boolean('is_warmup').notNull().default(false),
    weightG: integer('weight_g'),
    reps: smallint('reps'),
    rpe: rpeColumn('rpe'),
    durationS: integer('duration_s'),
    distanceMm: integer('distance_mm'),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * The phone's key for this set, so a retry of the same request is answered with this row
     * rather than logged again (`IDEMPOTENCY_KEY_HEADER` in the contract). Null for a client that
     * does not retry, and for every set logged before keys existed.
     */
    idempotencyKey: uuid('idempotency_key'),
  },
  (t) => [
    /** One set per key in a session — the backstop to the check `logSet` makes under its lock. */
    uniqueIndex('set_logs_idempotency_idx').on(t.sessionId, t.idempotencyKey),
    /**
     * Per-exercise history, and the series a progress chart will read later without a schema
     * change. The largest table in the system by an order of magnitude.
     *
     * No query orders by `logged_at DESC` yet. The one that does must either add `.nullsFirst()`
     * here (a rebuild of the largest table) or order `desc nulls last` — see
     * workout_sessions_user_time_idx for how a NULLS mismatch silently becomes a sort.
     */
    index('set_logs_exercise_time_idx').on(t.exerciseId, t.loggedAt.desc()),
    index('set_logs_session_idx').on(t.sessionId),
    index('set_logs_entry_idx').on(t.entryId),
    check('set_logs_rpe_ck', rpeCheck(t.rpe)),
  ],
)
