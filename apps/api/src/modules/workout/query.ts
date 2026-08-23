import { and, eq, gt, ilike, or, sql } from 'drizzle-orm'
import type { WorkoutQuery } from '@cedo/contract'
import { visible } from '../../db/ownable.ts'
import { workoutFavourites, workouts } from '../../db/schema.ts'
import { invalid, unreachable } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

import { decodeCursor, escapeLikePattern } from '../../lib/keyset.ts'

function scopeFilter(query: WorkoutQuery, caller: Caller) {
  switch (query.scope) {
    case 'mine':
      return eq(workouts.ownerGroupId, caller.personalGroupId)
    case 'group':
      // Thrown rather than defaulted: an empty string fed to a uuid column is a database error.
      if (query.groupId === undefined) throw invalid("groupId is required when scope is 'group'")
      // Intersected with `visible` so an unreachable group yields an empty page, not a hint.
      return and(visible(workouts, caller), eq(workouts.ownerGroupId, query.groupId))
    case 'favourites':
    case 'all':
      return visible(workouts, caller)
    default:
      return unreachable(query.scope)
  }
}

export function listConditions(caller: Caller, query: WorkoutQuery) {
  const after = decodeCursor(query.cursor)
  const conditions = [scopeFilter(query, caller)]

  if (query.q !== undefined && query.q !== '') {
    conditions.push(ilike(workouts.name, `%${escapeLikePattern(query.q)}%`))
  }

  if (after !== null) {
    conditions.push(
      or(
        gt(workouts.name, after.name),
        and(eq(workouts.name, after.name), gt(workouts.id, after.id)),
      ),
    )
  }

  if (query.scope === 'favourites') {
    conditions.push(
      sql`exists (select 1 from ${workoutFavourites} where ${workoutFavourites.targetId} = ${workouts.id} and ${workoutFavourites.userId} = ${caller.userId})`,
    )
  }

  return conditions
}
