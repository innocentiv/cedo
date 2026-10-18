import { visibleWorkouts } from '../../db/visible.ts'
import { ownableLifecycle, relationOf } from '../ownable/service.ts'
import { assertWorkoutCanTravel } from './references.ts'

/**
 * How a workout is an ownable: its name, its visible relation, and the one thing it does
 * differently — a transfer may only carry the plan into a group that can read every exercise it
 * uses. Everything else is the shared lifecycle, which holds the raw tables itself
 * (`ownable/write.ts`), so nothing here can read around a relation.
 * See docs/adr/0019-visible-relations.md.
 */
export const workoutLifecycle = ownableLifecycle({
  noun: 'workout',
  relation: (caller) => relationOf(visibleWorkouts(caller)),
  beforeTransfer: assertWorkoutCanTravel,
})
