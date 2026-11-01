import { eq, sql } from 'drizzle-orm'
import type { AthleteEquipment, AthleteEquipmentInput } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { athleteEquipment, users } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type Training, own } from '../coaching/training.ts'
import { columnsOf, heldBy } from './held.ts'

/**
 * What an athlete has to train with (#34): their own, read or replaced whole, and an athlete's read
 * by the coach they share their training with — through `Training`, as their sessions are.
 */

export const read = async (training: Training): Promise<AthleteEquipment> =>
  await heldBy(training.athleteId)

/**
 * Replaced whole, and said from now on. The person's row is locked first, so two saves at once
 * take turns rather than both deleting and both inserting into one primary key.
 */
export async function replace(
  caller: Caller,
  input: AthleteEquipmentInput,
): Promise<AthleteEquipment> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ equipmentDescribedAt: sql`now()` })
      .where(eq(users.id, caller.userId))
    await tx.delete(athleteEquipment).where(eq(athleteEquipment.userId, caller.userId))
    if (input.items.length === 0) return
    await tx
      .insert(athleteEquipment)
      .values(
        input.items.map((i) => ({ userId: caller.userId, item: i.slug, ...columnsOf(i.weights) })),
      )
  })
  return await read(own(caller))
}
