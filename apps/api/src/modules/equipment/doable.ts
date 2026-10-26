import { type AnyColumn, type SQL, eq, isNotNull, sql } from 'drizzle-orm'
import type { Kit } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { athleteEquipment, users } from '../../db/schema.ts'

/**
 * Doable (#35), as the server decides it: what a reader has, read once a request, and the same
 * rule as a list's condition. The rule itself is the contract's (`isDoable`); the condition below
 * says it in SQL, and `doable.test.ts` holds the two to one answer.
 */

/** What a reader has, in one query: whether they said, and the items. */
export async function kitOf(userId: string): Promise<Kit> {
  const rows = await db
    .select({ describedAt: users.equipmentDescribedAt, item: athleteEquipment.item })
    .from(users)
    .leftJoin(athleteEquipment, eq(athleteEquipment.userId, users.id))
    .where(eq(users.id, userId))
  return {
    described: (rows[0]?.describedAt ?? null) !== null,
    items: rows.flatMap((r) => (r.item === null ? [] : [{ slug: r.item }])),
  }
}

/**
 * Only what `userId` can do, for a list's WHERE: needs undescribed, a reader who has not said, or
 * every item needed among theirs.
 */
export const doableFor = (userId: string, needs: AnyColumn): SQL =>
  sql`(${needs} is null or not exists (${db
    .select({ one: sql`1` })
    .from(users)
    .where(
      sql`${eq(users.id, userId)} and ${isNotNull(users.equipmentDescribedAt)}`,
    )}) or ${needs} <@ coalesce((${db
    .select({ items: sql`array_agg(${athleteEquipment.item})` })
    .from(athleteEquipment)
    .where(eq(athleteEquipment.userId, userId))}), '{}'::equipment_item[]))`
