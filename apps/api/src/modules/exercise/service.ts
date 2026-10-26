import {
  type Exercise,
  type ExerciseCreate,
  type ExerciseCreateRequest,
  type ExerciseQuery,
  type ExerciseUpdate,
  type Page,
  type RecentExercisesQuery,
  exerciseInputFrom,
} from '@cedo/contract'
import { assertEditorOf } from '../../db/ownable.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { requireCurator } from '../review/curation.ts'
import { recentlyLogged } from '../session/recent.ts'
import { own } from '../session/service.ts'
import { exerciseLifecycle } from './lifecycle.ts'
import { hydrate } from './mapper.ts'
import { insertExercise, updateExercise } from './write.ts'

/**
 * Listing, reading, pinning, transfer and delete are the shared ownable lifecycle
 * (`lifecycle.ts`); what is an exercise's own is its muscles and media — hydrated by `mapper.ts`
 * — and its create and update, in `write.ts`.
 */

/**
 * The library as the caller can see it — only what is doable unless `showAll` (#35), judged by the
 * caller's equipment, or by an athlete's they plan for (checked by the caller of this).
 */
export async function list(
  caller: Caller,
  query: ExerciseQuery,
  judgedFor: string = caller.userId,
): Promise<Page<Exercise>> {
  const page = await exerciseLifecycle.list(caller, { ...query, judgedFor })
  return { items: await hydrate(caller, page.items, judgedFor), nextCursor: page.nextCursor }
}

export async function get(caller: Caller, id: string): Promise<Exercise> {
  const [hydrated] = await hydrate(caller, [await exerciseLifecycle.get(caller, id)])
  if (hydrated === undefined) throw notFound('exercise')
  return hydrated
}

/**
 * What the picker leads with (#27): the exercises the caller logged most lately, latest first — of
 * those they can still see. Asked for twice as many as wanted, so a few lost since do not leave the
 * list short.
 */
export async function recent(caller: Caller, query: RecentExercisesQuery): Promise<Exercise[]> {
  const seen = await exerciseLifecycle.getMany(
    caller,
    await recentlyLogged(own(caller), query.limit * 2),
  )
  return await hydrate(caller, seen.slice(0, query.limit))
}

/**
 * Into the caller's own group, or — `shared` — into the shared library, which only a curator may
 * write to. Decided here, not by whichever surface offers it, so none can forget the check: a
 * non-curator gets a 404, like any write they may not make.
 */
export async function create(
  caller: Caller,
  { shared, ...input }: ExerciseCreateRequest,
): Promise<Exercise> {
  return await createInGroup(
    caller,
    input,
    shared ? await requireCurator(caller) : caller.personalGroupId,
  )
}

async function createInGroup(
  caller: Caller,
  input: ExerciseCreate,
  ownerGroupId: string,
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

  return await createInGroup(caller, exerciseInputFrom(await get(caller, id)), target)
}

export async function transfer(caller: Caller, id: string, toGroupId: string): Promise<Exercise> {
  await exerciseLifecycle.transfer(caller, id, toGroupId)
  return await get(caller, id)
}

export async function setFavourite(caller: Caller, id: string, favourite: boolean): Promise<void> {
  await exerciseLifecycle.setFavourite(caller, id, favourite)
}
