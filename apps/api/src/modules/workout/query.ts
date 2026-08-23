import { and, eq, gt, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { WorkoutQuery } from '@cedo/contract'
import { visible } from '../../db/ownable.ts'
import { workoutFavourites, workouts } from '../../db/schema.ts'
import { invalid, unreachable } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * Keyset on (name, id), matching `workouts_owner_name_idx`. Identical in shape to the exercise
 * version — see `modules/exercise/query.ts` for why offset pagination is not used.
 */
export const encodeCursor = (name: string, id: string) =>
  Buffer.from(JSON.stringify([name, id])).toString('base64url')

/** A cursor is client input, so it is parsed, not trusted. A malformed one means "start over". */
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

/** `%`, `_` and `\` are LIKE wildcards; unescaped, a search term silently acts as a pattern. */
const escapeLikePattern = (term: string) => term.replaceAll(/[\\%_]/gu, (m) => `\\${m}`)

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
