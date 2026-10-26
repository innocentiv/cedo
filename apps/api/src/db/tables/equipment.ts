import { sql } from 'drizzle-orm'
import { check, integer, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core'
import { equipmentItem } from './exercise.ts'
import { users } from './identity.ts'

/**
 * What an athlete has to train with (#34): one row an item, and for an item that holds the load, how
 * its weights go, in grams — all three or none, none being unknown. Whether they have said at all
 * is `users.equipment_described_at`: no rows is nothing at all only once they have.
 *
 * PERSONAL, as sessions are: a user's own, never shared, read by a coach only through `Training`.
 */
export const athleteEquipment = pgTable(
  'athlete_equipment',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    item: equipmentItem('item').notNull(),
    stepG: integer('step_g'),
    minG: integer('min_g'),
    maxG: integer('max_g'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.item] }),
    check(
      'athlete_equipment_weights_ck',
      sql`(${t.stepG} is null and ${t.minG} is null and ${t.maxG} is null) or (${t.stepG} > 0 and ${t.minG} >= 0 and (${t.maxG} is null or (${t.maxG} > 0 and ${t.maxG} >= ${t.minG})))`,
    ),
  ],
)
