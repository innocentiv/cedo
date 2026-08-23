import { and, eq, gt, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { ExerciseQuery } from '@cedo/contract'
import { visible } from '../../db/ownable.ts'
import { exerciseFavourites, exerciseMuscles, exercises } from '../../db/schema.ts'
import { unreachable } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * Keyset pagination on (name, id): stable under concurrent inserts, unlike an offset, and it reads
 * straight down the index the list is ordered by. JSON-encoded because exercise names contain
 * spaces, so a naive separator would split in the wrong place.
 */
export const encodeCursor = (name: string, id: string) =>
  Buffer.from(JSON.stringify([name, id])).toString('base64url')

/** A cursor is client-supplied, so it is parsed, not trusted. A malformed one means "start over". */
const Cursor = z.tuple([z.string(), z.string()])

function decodeCursor(cursor: string | undefined): { name: string; id: string } | null {
  if (cursor === undefined) return null
  try {
    const parsed = Cursor.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
    if (!parsed.success) return null
    const [name, id] = parsed.data
    return { name, id }
  } catch {
    return null
  }
}

function scopeFilter(query: ExerciseQuery, caller: Caller) {
  switch (query.scope) {
    case 'mine':
      return eq(exercises.ownerGroupId, caller.personalGroupId)
    case 'group':
      /**
       * Intersected with `visible` deliberately: asking about a group the caller cannot reach
       * returns an empty page rather than an error that would confirm the group exists.
       */
      return and(visible(exercises, caller), eq(exercises.ownerGroupId, query.groupId ?? ''))
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

  if (query.q !== undefined && query.q !== '')
    conditions.push(ilike(exercises.name, `%${query.q}%`))

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
