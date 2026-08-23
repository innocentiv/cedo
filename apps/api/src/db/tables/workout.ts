import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { Progression } from '@cedo/contract'
import { favouriteTable, ownable } from '../ownable.ts'
import { exercises } from './exercise.ts'

export const workouts = pgTable(
  'workouts',
  {
    ...ownable(),
    notes: text('notes'),
  },
  (t) => [
    /**
     * Same shape as `exercises_owner_name_idx`, and for the same reason: `visible()` filters on
     * owner_group_id while the keyset cursor ranges and orders on (name, id). Without the
     * composite, Postgres sorts every visible workout on every page.
     * See docs/03-domain-model.md.
     */
    index('workouts_owner_name_idx').on(t.ownerGroupId, t.name, t.id),
    /** And the same pair without the owner, for the same reason. See `exercises_name_id_idx`. */
    index('workouts_name_id_idx').on(t.name, t.id),
  ],
)

export const workoutDays = pgTable(
  'workout_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    index: smallint('index').notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    index('workout_days_workout_idx').on(t.workoutId),
    uniqueIndex('workout_days_order_idx').on(t.workoutId, t.index),
  ],
)

/**
 * Entries within a day sharing a `superset_group` letter are performed alternating; null means
 * performed alone. A tag rather than a nesting level, so reordering is one integer update.
 */
export const workoutEntries = pgTable(
  'workout_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dayId: uuid('day_id')
      .notNull()
      .references(() => workoutDays.id, { onDelete: 'cascade' }),
    index: smallint('index').notNull(),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    supersetGroup: char('superset_group', { length: 1 }),
    restSeconds: integer('rest_seconds'),
    /** Validated by the `Progression` union on read and write. No migration to add a rule kind. */
    progression: jsonb('progression').$type<Progression>().notNull().default({ kind: 'none' }),
  },
  (t) => [
    index('workout_entries_day_idx').on(t.dayId),
    uniqueIndex('workout_entries_order_idx').on(t.dayId, t.index),
    check(
      'workout_entries_superset_ck',
      sql`${t.supersetGroup} is null or ${t.supersetGroup} ~ '^[A-Z]$'`,
    ),
  ],
)

export const workoutSets = pgTable(
  'workout_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => workoutEntries.id, { onDelete: 'cascade' }),
    index: smallint('index').notNull(),
    /** Ramp-up sets. Excluded from progression and from volume totals. */
    isWarmup: boolean('is_warmup').notNull().default(false),
    targetReps: smallint('target_reps'),
    targetWeightG: integer('target_weight_g'),
    targetRpe: smallint('target_rpe'),
    targetDurationS: integer('target_duration_s'),
    targetDistanceMm: integer('target_distance_mm'),
  },
  (t) => [
    index('workout_sets_entry_idx').on(t.entryId),
    uniqueIndex('workout_sets_order_idx').on(t.entryId, t.index),
    check('workout_sets_rpe_ck', sql`${t.targetRpe} is null or ${t.targetRpe} between 1 and 10`),
  ],
)

export const workoutFavourites = favouriteTable('workout_favourites', workouts)
