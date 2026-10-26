import { type EquipmentSlug, type Load, type TrackingMode, loadOf } from '@cedo/contract'
import { useEquipment } from '../api/equipment-queries.ts'

/**
 * The weights the signed-in athlete can load on an exercise (#36) — what − / + step between, and a
 * plan's own targets are asked as — or null while their equipment is read, or does not say.
 */
export function useLoads(): (
  exercise:
    | { readonly equipment: readonly EquipmentSlug[] | null; readonly tracking: TrackingMode }
    | null
    | undefined,
) => Load | null {
  const held = useEquipment().data
  return (exercise) => (held === undefined || exercise == null ? null : loadOf(exercise, held))
}
