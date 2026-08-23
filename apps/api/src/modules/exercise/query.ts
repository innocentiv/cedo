import { and, eq, gt, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { ExerciseQuery } from '@cedo/contract'
import { visible } from '../../db/ownable.ts'
import { exerciseFavourites, exerciseMuscles, exercises } from '../../db/schema.ts'
import { invalid, unreachable } from '../../lib/error.ts'
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

/**
 * `%`, `_` and `\\` are wildcards to LIKE. Unescaped, searching for '50%' matches everything
 * starting '50', a lone '_' matches every row, and a bare '%' scans the whole table — defeating
 * the very index the search was built around. The value is parameterised, so this is about
 * correctness and cost, not injection.
 */
function escapeLikePattern(term: string): string {
  return term.replaceAll(/[\\%_]/gu, (match) => `\\${match}`)
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
