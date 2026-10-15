import { type SQL, and, eq, exists, gt, ilike, or, sql } from 'drizzle-orm'
import type { ExerciseQuery } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { exerciseFavourites } from '../../db/schema.ts'
import { visibleExerciseMuscles, visibleExercises } from '../../db/visible.ts'
import { invalid, unreachable } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

import { decodeCursor, escapeLikePattern } from '../../lib/keyset.ts'

type Visible = ReturnType<typeof visibleExercises<'exercises'>>

/** The caller's exercises with their own favourite flag, which every read returns. */
export function withFavourite(caller: Caller) {
  const visible = visibleExercises(caller)
  const rows = db
    .select()
    .from(visible)
    .leftJoin(
      exerciseFavourites,
      and(
        eq(exerciseFavourites.targetId, visible.id),
        eq(exerciseFavourites.userId, caller.userId),
      ),
    )
  return { visible, rows }
}

/**
 * Narrows what the visible relation already allows. Visibility itself is not a condition here: it
 * is the relation being filtered, so a scope can only ever be a subset of it.
 */
function scopeFilter(query: ExerciseQuery, caller: Caller, visible: Visible): (SQL | undefined)[] {
  switch (query.scope) {
    case 'mine':
      return [eq(visible.ownerGroupId, caller.personalGroupId)]
    case 'group':
      /**
       * Thrown, not defaulted. `?? ''` fed an empty string to a uuid column, which Postgres
       * rejects at cast time — a 500 for what is a programmer error. The HTTP route is protected
       * by ExerciseQuery's refine, but invariant 4 requires MCP tools to call this same function,
       * and `{ scope: 'group' }` without a groupId typechecks.
       *
       * A group the caller cannot reach yields an empty page rather than an error that would
       * confirm the group exists — the relation holds none of its rows.
       */
      if (query.groupId === undefined) throw invalid("groupId is required when scope is 'group'")
      return [eq(visible.ownerGroupId, query.groupId)]
    case 'favourites':
    case 'all':
      return []
    default:
      return unreachable(query.scope)
  }
}

export function listConditions(caller: Caller, query: ExerciseQuery, visible: Visible) {
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

  if (query.muscle !== undefined) {
    const muscles = visibleExerciseMuscles(caller)
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(muscles)
          .where(and(eq(muscles.exerciseId, visible.id), eq(muscles.muscleSlug, query.muscle))),
      ),
    )
  }

  if (query.scope === 'favourites') {
    conditions.push(
      sql`exists (select 1 from ${exerciseFavourites} where ${exerciseFavourites.targetId} = ${visible.id} and ${exerciseFavourites.userId} = ${caller.userId})`,
    )
  }

  return conditions
}
