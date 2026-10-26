import { asc, eq, sql } from 'drizzle-orm'
import type { AthleteEquipment, AthleteEquipmentInput, OwnedItem } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { athleteEquipment, users } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type Training, own } from '../session/service.ts'

/**
 * What an athlete has to train with (#34): their own, read or replaced whole, and an athlete's read
 * by the coach they share their training with — through `Training`, as their sessions are.
 */

export async function read(training: Training): Promise<AthleteEquipment> {
  const [[person], rows] = await Promise.all([
    db
      .select({ describedAt: users.equipmentDescribedAt })
      .from(users)
      .where(eq(users.id, training.athleteId)),
    db
      .select()
      .from(athleteEquipment)
      .where(eq(athleteEquipment.userId, training.athleteId))
      // The enum's own order, which is the list's: the checklist's order.
      .orderBy(asc(athleteEquipment.item)),
  ])
  return {
    described: (person?.describedAt ?? null) !== null,
    items: rows.map((r): OwnedItem => ({
      slug: r.item,
      weights:
        r.stepG === null || r.minG === null ? null : { stepG: r.stepG, minG: r.minG, maxG: r.maxG },
    })),
  }
}

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
    await tx.insert(athleteEquipment).values(
      input.items.map((i) => ({
        userId: caller.userId,
        item: i.slug,
        stepG: i.weights?.stepG ?? null,
        minG: i.weights?.minG ?? null,
        maxG: i.weights?.maxG ?? null,
      })),
    )
  })
  return await read(own(caller))
}
