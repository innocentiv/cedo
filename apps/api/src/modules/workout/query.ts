import { type SQL, and, eq, gt, ilike, or, sql } from 'drizzle-orm'
import type { WorkoutQuery } from '@cedo/contract'
import { workoutFavourites } from '../../db/schema.ts'
import type { visibleWorkouts } from '../../db/visible.ts'
import { invalid, unreachable } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

import { decodeCursor, escapeLikePattern } from '../../lib/keyset.ts'

type Visible = ReturnType<typeof visibleWorkouts<'workouts'>>

/** Narrows the visible relation; visibility itself is the relation, never a condition here. */
function scopeFilter(query: WorkoutQuery, caller: Caller, visible: Visible): (SQL | undefined)[] {
  switch (query.scope) {
    case 'mine':
      return [eq(visible.ownerGroupId, caller.personalGroupId)]
    case 'group':
      // Thrown rather than defaulted: an empty string fed to a uuid column is a database error.
      // A group the caller cannot reach yields an empty page, not a hint that it exists.
      if (query.groupId === undefined) throw invalid("groupId is required when scope is 'group'")
      return [eq(visible.ownerGroupId, query.groupId)]
    case 'favourites':
    case 'all':
      return []
    default:
      return unreachable(query.scope)
  }
}

export function listConditions(caller: Caller, query: WorkoutQuery, visible: Visible) {
  const after = decodeCursor(query.cursor)
  const conditions = scopeFilter(query, caller, visible)

  if (query.q !== undefined && query.q !== '') {
    conditions.push(ilike(visible.name, `%${escapeLikePattern(query.q)}%`))
  }

  if (after !== null) {
    conditions.push(
      or(gt(visible.name, after.name), and(eq(visible.name, after.name), gt(visible.id, after.id))),
    )
  }

  if (query.scope === 'favourites') {
    conditions.push(
      sql`exists (select 1 from ${workoutFavourites} where ${workoutFavourites.targetId} = ${visible.id} and ${workoutFavourites.userId} = ${caller.userId})`,
    )
  }

  return conditions
}
