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
import { TRACKING_MODES } from '@cedo/contract'
import { favouriteTable, ownable } from '../ownable.ts'
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
    index('exercises_owner_idx').on(t.ownerGroupId),
    /** Trigram index for substring search across a library that will reach five figures. */
    index('exercises_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
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
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    muscleSlug: text('muscle_slug')
      .notNull()
      .references(() => muscles.slug, { onDelete: 'restrict' }),
    loadPct: smallint('load_pct').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.exerciseId, t.muscleSlug] }),
    /** Filtering the library by muscle. */
    index('exercise_muscles_muscle_idx').on(t.muscleSlug),
    check('exercise_muscles_load_pct_ck', sql`${t.loadPct} between 1 and 100`),
  ],
)

export const exerciseMedia = pgTable(
  'exercise_media',
  {
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    sortIndex: smallint('sort_index').notNull(),
  },
  (t) => [primaryKey({ columns: [t.exerciseId, t.mediaId] })],
)

export const exerciseFavourites = favouriteTable('exercise_favourites', exercises)
