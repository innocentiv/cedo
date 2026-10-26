import { type LoadFor, type LoadedExercise, loadOf } from '@cedo/contract'
import { useEquipment } from '../api/equipment-queries.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * The weights the signed-in athlete can load on an exercise (#36), counted in the unit they read —
 * what − / + step between, and what a plan's own targets are asked as — or null while their
 * equipment is read, or does not say. The contract's `loadOf`, with their equipment bound.
 */
export function useLoads(): (exercise: LoadedExercise | null | undefined) => ReturnType<LoadFor> {
  const held = useEquipment().data
  const unit = useWeightUnit()
  return (exercise) =>
    held === undefined || exercise == null ? null : loadOf(exercise, held, unit)
}
