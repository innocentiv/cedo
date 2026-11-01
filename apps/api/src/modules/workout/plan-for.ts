import type { AthleteEquipment, PlanSave, Workout } from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import { type Training, own } from '../coaching/training.ts'
import { read as readEquipment } from '../equipment/service.ts'
import { get, replacePlan } from './service.ts'

/** A plan, and what the athlete it is read for has to train with. */
export interface PlanRead {
  readonly workout: Workout
  readonly held: AthleteEquipment
}

/**
 * A workout read for an athlete — the caller, or one a coach writes it for — with what they have:
 * its exercises marked doable or not (#35), and its weights readable as they can load them (#36).
 */
export async function planFor(training: Training, workoutId: string): Promise<PlanRead> {
  const [workout, held] = await Promise.all([get(training, workoutId), readEquipment(training)])
  return { workout, held }
}

/** A plan saved whole, read back as `planFor` reads the caller's own. */
export async function savePlanAndRead(
  caller: Caller,
  workoutId: string,
  plan: PlanSave,
): Promise<PlanRead> {
  const workout = await replacePlan(caller, workoutId, plan)
  return { workout, held: await readEquipment(own(caller)) }
}
