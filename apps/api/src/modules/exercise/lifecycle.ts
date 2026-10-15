import { and, eq, exists, sql } from 'drizzle-orm'
import type { ExerciseQuery } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { exerciseFavourites, exercises } from '../../db/schema.ts'
import { visibleExerciseMuscles, visibleExercises } from '../../db/visible.ts'
import { ownableLifecycle, relationOf } from '../ownable/service.ts'

/**
 * How an exercise is an ownable: its relation, its tables, and the two things it does differently
 * — a list filtered by the muscle it loads, and a delete refused while a plan or a log uses it.
 * Everything else is the shared lifecycle. A lifecycle file may name the raw tables, because
 * transfer and delete write to them. See docs/adr/0019-visible-relations.md.
 */
export const exerciseLifecycle = ownableLifecycle({
  noun: 'exercise',
  table: exercises,
  favourites: exerciseFavourites,
  relation: (caller) => relationOf(visibleExercises(caller)),
  listConditions: (caller, query: ExerciseQuery, relation) => {
    if (query.muscle === undefined) return []
    const muscles = visibleExerciseMuscles(caller)
    return [
      exists(
        db
          .select({ one: sql`1` })
          .from(muscles)
          .where(and(eq(muscles.exerciseId, relation.id), eq(muscles.muscleSlug, query.muscle))),
      ),
    ]
  },
  inUse:
    'That exercise is used by a plan or by logged history, so it cannot be deleted. ' +
    'Remove it from the plans that use it; logged history keeps it for good.',
})
