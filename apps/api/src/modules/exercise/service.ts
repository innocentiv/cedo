import type { Exercise, ExerciseCreate, ExerciseQuery, ExerciseUpdate, Page } from '@cedo/contract'
import { assertEditorOf } from '../../db/ownable.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { exerciseLifecycle } from './lifecycle.ts'
import { hydrate } from './mapper.ts'
import { insertExercise, updateExercise } from './write.ts'

/**
 * Listing, reading, pinning, transfer and delete are the shared ownable lifecycle
 * (`lifecycle.ts`); what is an exercise's own is its muscles and media — hydrated here — and its
 * create and update, in `write.ts`.
 */

export async function list(caller: Caller, query: ExerciseQuery): Promise<Page<Exercise>> {
  const page = await exerciseLifecycle.list(caller, query)
  return { items: await hydrate(caller, page.items), nextCursor: page.nextCursor }
}

export async function get(caller: Caller, id: string): Promise<Exercise> {
  const [hydrated] = await hydrate(caller, [await exerciseLifecycle.get(caller, id)])
  if (hydrated === undefined) throw notFound('exercise')
  return hydrated
}

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
  await exerciseLifecycle.remove(caller, id)
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
  await exerciseLifecycle.transfer(caller, id, toGroupId)
  return await get(caller, id)
}

export async function setFavourite(caller: Caller, id: string, favourite: boolean): Promise<void> {
  await exerciseLifecycle.setFavourite(caller, id, favourite)
}
