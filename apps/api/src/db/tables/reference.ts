import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { MEDIA_KINDS, MUSCLE_REGIONS, type MediaPayload } from '@cedo/contract'
import { users } from './identity.ts'

export const muscleRegion = pgEnum('muscle_region', MUSCLE_REGIONS)
export const mediaKind = pgEnum('media_kind', MEDIA_KINDS)

/**
 * Seeded from the `MUSCLES` constant in @cedo/contract, which is the source of truth. The table
 * exists so exercises get foreign-key integrity and joinability — never insert into it directly.
 */
export const muscles = pgTable(
  'muscles',
  {
    slug: text('slug').primaryKey(),
    name: text('name').notNull(),
    region: muscleRegion('region').notNull(),
    sortIndex: integer('sort_index').notNull(),
  },
  (t) => [index('muscles_region_idx').on(t.region, t.sortIndex)],
)

/**
 * Images and video links. Common columns plus a JSONB payload validated by a discriminated union,
 * so adding `video_upload` or `model_3d` later is a union extension with no migration.
 * See docs/03-domain-model.md.
 */
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: mediaKind('kind').notNull(),
    title: text('title').notNull().default(''),
    payload: jsonb('payload').$type<MediaPayload>().notNull(),
    /** BlobStore key for a generated thumbnail; null when derived or unavailable. */
    thumbnailKey: text('thumbnail_key'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('media_created_by_idx').on(t.createdBy)],
)
