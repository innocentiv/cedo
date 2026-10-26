import { type AnyColumn, type SQL, and, eq, exists, sql } from 'drizzle-orm'
import type { ExerciseQuery } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visibleExerciseMuscles, visibleExercises } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { doableFor } from '../equipment/doable.ts'
import { ownableLifecycle, relationOf } from '../ownable/service.ts'

/**
 * How an exercise is an ownable: its name, its visible relation, and the things it does
 * differently — a list of only what the caller can do (#35) and filtered by the muscle it loads,
 * and a delete refused while a plan or a log uses it. Everything else is the shared lifecycle,
 * which holds the raw tables itself (`ownable/write.ts`), so nothing here can read around a
 * relation. See docs/adr/0019-visible-relations.md.
 */
export const exerciseLifecycle = ownableLifecycle({
  noun: 'exercise',
  relation: (caller) => relationOf(visibleExercises(caller)),
  listConditions: (caller, query: ExerciseQuery, relation) => [
    query.showAll === true ? undefined : doableFor(caller.userId, relation.row.equipment),
    byMuscle(caller, query, relation.id),
  ],
  inUse:
    'That exercise is used by a plan or by logged history, so it cannot be deleted. ' +
    'Remove it from the plans that use it; logged history keeps it for good.',
})

function byMuscle(caller: Caller, query: ExerciseQuery, id: AnyColumn): SQL | undefined {
  if (query.muscle === undefined) return undefined
  const muscles = visibleExerciseMuscles(caller)
  return exists(
    db
      .select({ one: sql`1` })
      .from(muscles)
      .where(and(eq(muscles.exerciseId, id), eq(muscles.muscleSlug, query.muscle))),
  )
}
