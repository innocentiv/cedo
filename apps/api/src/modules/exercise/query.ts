import { and, eq, gt, ilike, or, sql } from 'drizzle-orm'
import type { ExerciseQuery } from '@cedo/contract'
import { visible } from '../../db/ownable.ts'
import { exerciseFavourites, exerciseMuscles, exercises } from '../../db/schema.ts'
import { invalid, unreachable } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

import { decodeCursor, escapeLikePattern } from '../../lib/keyset.ts'

function scopeFilter(query: ExerciseQuery, caller: Caller) {
  switch (query.scope) {
    case 'mine':
      return eq(exercises.ownerGroupId, caller.personalGroupId)
    case 'group': {
      /**
       * Thrown, not defaulted. `?? ''` fed an empty string to a uuid column, which Postgres
       * rejects at cast time — a 500 for what is a programmer error. The HTTP route is protected
       * by ExerciseQuery's refine, but invariant 4 requires MCP tools to call this same function,
       * and `{ scope: 'group' }` without a groupId typechecks.
       */
      if (query.groupId === undefined) throw invalid("groupId is required when scope is 'group'")
      /**
       * Intersected with `visible` deliberately: asking about a group the caller cannot reach
       * returns an empty page rather than an error that would confirm the group exists.
       */
      return and(visible(exercises, caller), eq(exercises.ownerGroupId, query.groupId))
    }
    case 'favourites':
    case 'all':
      return visible(exercises, caller)
    default:
      return unreachable(query.scope)
  }
}

export function listConditions(caller: Caller, query: ExerciseQuery) {
  const after = decodeCursor(query.cursor)
  const conditions = [scopeFilter(query, caller)]

  if (query.q !== undefined && query.q !== '') {
    conditions.push(ilike(exercises.name, `%${escapeLikePattern(query.q)}%`))
  }

  if (after !== null) {
    conditions.push(
      or(
        gt(exercises.name, after.name),
        and(eq(exercises.name, after.name), gt(exercises.id, after.id)),
      ),
    )
  }

  if (query.muscle !== undefined) {
    conditions.push(
      sql`exists (select 1 from ${exerciseMuscles} where ${exerciseMuscles.exerciseId} = ${exercises.id} and ${exerciseMuscles.muscleSlug} = ${query.muscle})`,
    )
  }

  if (query.scope === 'favourites') {
    conditions.push(
      sql`exists (select 1 from ${exerciseFavourites} where ${exerciseFavourites.targetId} = ${exercises.id} and ${exerciseFavourites.userId} = ${caller.userId})`,
    )
  }

  return conditions
}
