import { type AnyColumn, type SQL, and, eq, exists, isNotNull, not, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { athleteEquipment, users } from '../../db/schema.ts'

/**
 * Doable (#35) as a list's condition: the contract's `isDoable` said in SQL, for the athlete whose
 * equipment judges it — the reader, or the athlete a coach plans for. `doable.test.ts` asks both on
 * one set of exercises, so they cannot disagree.
 */
export function doableFor(athleteId: string, needs: AnyColumn): SQL {
  const described = db
    .select({ one: sql`1` })
    .from(users)
    .where(and(eq(users.id, athleteId), isNotNull(users.equipmentDescribedAt)))
  const theirs = db
    .select({ items: sql`array_agg(${athleteEquipment.item})` })
    .from(athleteEquipment)
    .where(eq(athleteEquipment.userId, athleteId))
  const allHad = sql`${needs} <@ coalesce((${theirs}), '{}'::equipment_item[])`
  return or(sql`${needs} is null`, not(exists(described)), allHad) ?? sql`true`
}
