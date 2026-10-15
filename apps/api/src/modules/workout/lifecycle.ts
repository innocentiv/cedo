import { workoutFavourites, workouts } from '../../db/schema.ts'
import { visibleWorkouts } from '../../db/visible.ts'
import { ownableLifecycle } from '../ownable/service.ts'
import { assertWorkoutCanTravel } from './transfer.ts'

/**
 * How a workout is an ownable: its relation, its tables, and the one thing it does differently — a
 * transfer may only carry the plan into a group that can read every exercise it uses. Everything
 * else is the shared lifecycle. A lifecycle file may name the raw tables, because transfer and
 * delete write to them. See docs/adr/0019-visible-relations.md.
 */
export const workoutLifecycle = ownableLifecycle({
  noun: 'workout',
  table: workouts,
  favourites: workoutFavourites,
  view: (caller) => {
    const visible = visibleWorkouts(caller)
    return {
      from: visible,
      row: visible._.selectedFields,
      id: visible.id,
      name: visible.name,
      ownerGroupId: visible.ownerGroupId,
    }
  },
  beforeTransfer: assertWorkoutCanTravel,
})
