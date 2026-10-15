import { and, asc, eq } from 'drizzle-orm'
import type { Exercise, ExerciseCreate, ExerciseQuery, ExerciseUpdate, Page } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { assertEditorOf } from '../../db/ownable.ts'
import { visibleExercises } from '../../db/visible.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { hydrate } from './mapper.ts'
import { encodeCursor } from '../../lib/keyset.ts'
import { listConditions, withFavourite } from './query.ts'
import {
  deleteExercise,
  insertExercise,
  transferExercise,
  updateExercise,
  writeFavourite,
} from './write.ts'

export async function list(caller: Caller, query: ExerciseQuery): Promise<Page<Exercise>> {
  const { visible, rows: select } = withFavourite(caller)
  // One row beyond the limit answers "is there more?" without a second count query.
  const rows = await select
    .where(and(...listConditions(caller, query, visible)))
    .orderBy(asc(visible.name), asc(visible.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = rows.slice(0, query.limit)
  const last = items.at(-1)?.exercises
  const favouriteIds = new Set(
    items.filter((r) => r.exercise_favourites !== null).map((r) => r.exercises.id),
  )

  return {
    items: await hydrate(
      items.map((r) => r.exercises),
      favouriteIds,
      caller,
    ),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.name, last.id) : null,
  }
}

export async function get(caller: Caller, id: string): Promise<Exercise> {
  const { visible, rows: select } = withFavourite(caller)
  const [row] = await select.where(eq(visible.id, id)).limit(1)
  if (row === undefined) throw notFound('exercise')

  const [hydrated] = await hydrate(
    [row.exercises],
    new Set(row.exercise_favourites === null ? [] : [row.exercises.id]),
    caller,
  )
  if (hydrated === undefined) throw notFound('exercise')
  return hydrated
}

// ---------------------------------------------------------------------------------------------
// Writes — the statements live in write.ts; each answers with the exercise as now read back.
// ---------------------------------------------------------------------------------------------

export async function create(
  caller: Caller,
  input: ExerciseCreate,
  ownerGroupId = caller.personalGroupId,
): Promise<Exercise> {
  return await get(caller, await insertExercise(caller, input, ownerGroupId))
}

export async function update(caller: Caller, id: string, patch: ExerciseUpdate): Promise<Exercise> {
  await updateExercise(caller, id, patch)
  return await get(caller, id)
}

export async function remove(caller: Caller, id: string): Promise<void> {
  await deleteExercise(caller, id)
}

/**
 * The escape hatch from a read-only shared library: copy something you can see into somewhere you
 * can write, then edit the copy. Muscles and media links come with it; the media rows themselves
 * are shared, not duplicated, because they are immutable content-addressed blobs.
 */
export async function duplicate(caller: Caller, id: string, toGroupId?: string): Promise<Exercise> {
  const target = toGroupId ?? caller.personalGroupId
  assertEditorOf(caller, target)

  const source = await get(caller, id)
  return await create(
    caller,
    {
      name: source.name,
      tracking: source.tracking,
      description: source.description,
      instructions: source.instructions,
      equipment: source.equipment,
      isUnilateral: source.isUnilateral,
      muscles: source.muscles,
      mediaIds: source.mediaIds,
    },
    target,
  )
}

export async function transfer(caller: Caller, id: string, toGroupId: string): Promise<Exercise> {
  await transferExercise(caller, id, toGroupId)
  return await get(caller, id)
}

export async function setFavourite(caller: Caller, id: string, favourite: boolean): Promise<void> {
  // Only things the caller can SEE can be pinned — visibility, not editability.
  const visible = visibleExercises(caller)
  const [found] = await db
    .select({ id: visible.id })
    .from(visible)
    .where(eq(visible.id, id))
    .limit(1)
  if (found === undefined) throw notFound('exercise')

  await writeFavourite(caller, id, favourite)
}
