import { asc, eq } from 'drizzle-orm'
import {
  type AthleteEquipment,
  type ItemWeights,
  type LoadFor,
  type WeightUnit,
  loadOf,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { athleteEquipment, users } from '../../db/schema.ts'

/**
 * What someone has to train with (#34), in ONE query: their row, and their items joined onto it.
 * The one reader of it — their equipment screen, their coach, and whether each exercise they read
 * is doable (#35) — so none can read it differently. By id: whose it may be is the caller's to
 * decide (`Training`), before it gets here.
 */
export async function heldBy(userId: string): Promise<AthleteEquipment> {
  const rows = await db
    .select({
      describedAt: users.equipmentDescribedAt,
      slug: athleteEquipment.item,
      stepG: athleteEquipment.stepG,
      minG: athleteEquipment.minG,
      maxG: athleteEquipment.maxG,
    })
    .from(users)
    .leftJoin(athleteEquipment, eq(athleteEquipment.userId, users.id))
    .where(eq(users.id, userId))
    // The enum's own order, which is the list's: the checklist's order.
    .orderBy(asc(athleteEquipment.item))
  return {
    described: (rows[0]?.describedAt ?? null) !== null,
    items: rows.flatMap((r) => (r.slug === null ? [] : [{ slug: r.slug, weights: weightsOf(r) }])),
  }
}

/** A row's weights: all three columns or none, as its CHECK holds them — none is not known. */
const weightsOf = (r: {
  readonly stepG: number | null
  readonly minG: number | null
  readonly maxG: number | null
}): ItemWeights | null =>
  r.stepG === null || r.minG === null ? null : { stepG: r.stepG, minG: r.minG, maxG: r.maxG }

/** A row's columns for its weights, none being not known. */
export const columnsOf = (weights: ItemWeights | null) => ({
  stepG: weights?.stepG ?? null,
  minG: weights?.minG ?? null,
  maxG: weights?.maxG ?? null,
})

/**
 * What someone can load on any exercise (#36), in the unit they read: read once, for a whole plan's
 * targets or progression.
 */
export async function loadsOf(userId: string, unit: WeightUnit): Promise<LoadFor> {
  const held = await heldBy(userId)
  return (exercise) => loadOf(exercise, held, unit)
}
