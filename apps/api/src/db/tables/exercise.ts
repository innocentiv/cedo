import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core'
import { type MuscleSlug, TRACKING_MODES } from '@cedo/contract'
import { childOwner, favouriteTable, ownable, ownerKey, ownerTarget } from '../ownable.ts'
import { media, muscles } from './reference.ts'

export const trackingMode = pgEnum('tracking_mode', TRACKING_MODES)

export const exercises = pgTable(
  'exercises',
  {
    ...ownable(),
    /**
     * How the exercise is measured. Drives which inputs the UI renders and which dimension a
     * progression rule advances. See docs/adr/0012-progression-rules.md.
     */
    tracking: trackingMode('tracking').notNull().default('weight_reps'),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    equipment: text('equipment'),
    /** Logged weight is per side. A display hint; sides are not logged separately. */
    isUnilateral: boolean('is_unilateral').notNull().default(false),
  },
  (t) => [
    /**
     * Serves the whole list query in one index walk: `visible()` filters on owner_group_id, and
     * the keyset cursor both ranges and orders on (name, id). Without it Postgres sequentially
     * scanned every visible exercise and sorted, so page 200 cost the same as page 1.
     *
     * `owner_group_id` alone needs no separate index — it is this one's left prefix.
     */
    index('exercises_owner_name_idx').on(t.ownerGroupId, t.name, t.id),
    /**
     * The SAME columns without the owner, and it is not redundant.
     *
     * The composite above serves `scope=mine` and `scope=group`, where owner_group_id is a single
     * equality and the index walks in (name, id) order underneath it. It CANNOT serve the default
     * `scope=all`: there the filter is `owner_group_id in (…52 groups…)`, and Postgres has no plan
     * that walks 52 index ranges in merged name order — it read all 11,000 visible rows and
     * top-N sorted them, on every page, measured at 2.4ms and growing with the library.
     *
     * Leading on (name, id) lets the keyset walk in order and stop at the page size: 0.15ms and
     * 48 buffers instead of 332, constant as the library grows. It works precisely because every
     * user is a reader of the shared group, so a caller can see most of the table and the walk
     * finds a full page immediately. See docs/10-testing.md.
     */
    index('exercises_name_id_idx').on(t.name, t.id),
    /**
     * Substring search. A GIN trigram index can serve neither ORDER BY nor a range on `name`.
     * `fastupdate = off`: every entry is written straight in, never parked in the pending list each
     * lookup would scan linearly until a vacuum — 5s instead of 0.3s per search after a bulk import.
     * Exercises are written rarely and searched constantly. See db/trigram.test.ts.
     */
    index('exercises_name_trgm_idx')
      .using('gin', sql`${t.name} gin_trgm_ops`)
      .with({ fastupdate: false }),
    ownerTarget('exercises_id_owner_uq', t),
  ],
)

/**
 * Load percentages sum to 100 per exercise — enforced in the contract, because a database-level
 * check cannot span rows without a trigger, and the contract error is the one a caller can act on.
 * The per-row bound is checked here so a bad direct insert still fails.
 */
export const exerciseMuscles = pgTable(
  'exercise_muscles',
  {
    exerciseId: uuid('exercise_id').notNull(),
    ...childOwner(),
    /** `$type` only narrows TypeScript; the foreign key is what actually constrains the value. */
    muscleSlug: text('muscle_slug')
      .$type<MuscleSlug>()
      .notNull()
      .references(() => muscles.slug, { onDelete: 'restrict' }),
    loadPct: smallint('load_pct').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.exerciseId, t.muscleSlug] }),
    ownerKey('exercise_muscles_exercise_fk', [t.exerciseId, t.ownerGroupId], exercises),
    /** Filtering the library by muscle. */
    index('exercise_muscles_muscle_idx').on(t.muscleSlug),
    check('exercise_muscles_load_pct_ck', sql`${t.loadPct} between 1 and 100`),
  ],
)

export const exerciseMedia = pgTable(
  'exercise_media',
  {
    exerciseId: uuid('exercise_id').notNull(),
    ...childOwner(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    sortIndex: smallint('sort_index').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.exerciseId, t.mediaId] }),
    ownerKey('exercise_media_exercise_fk', [t.exerciseId, t.ownerGroupId], exercises),
  ],
)

export const exerciseFavourites = favouriteTable('exercise_favourites', exercises)
