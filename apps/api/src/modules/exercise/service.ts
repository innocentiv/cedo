import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Exercise, ExerciseCreate, ExerciseQuery, ExerciseUpdate, Page } from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { editable, visible } from '../../db/ownable.ts'
import {
  exerciseFavourites,
  exerciseMedia,
  exerciseMuscles,
  exercises,
  media,
} from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { hydrate } from './mapper.ts'
import { encodeCursor, listConditions } from './query.ts'

export async function list(caller: Caller, query: ExerciseQuery): Promise<Page<Exercise>> {
  // One row beyond the limit answers "is there more?" without a second count query.
  const rows = await db
    .select({ exercise: exercises, favourite: exerciseFavourites.targetId })
    .from(exercises)
    .leftJoin(
      exerciseFavourites,
      and(
        eq(exerciseFavourites.targetId, exercises.id),
        eq(exerciseFavourites.userId, caller.userId),
      ),
    )
    .where(and(...listConditions(caller, query)))
    .orderBy(asc(exercises.name), asc(exercises.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = rows.slice(0, query.limit)
  const last = items.at(-1)
  const favouriteIds = new Set(items.filter((r) => r.favourite !== null).map((r) => r.exercise.id))

  return {
    items: await hydrate(
      items.map((r) => r.exercise),
      favouriteIds,
      caller,
    ),
    nextCursor:
      hasMore && last !== undefined ? encodeCursor(last.exercise.name, last.exercise.id) : null,
  }
}

export async function get(caller: Caller, id: string): Promise<Exercise> {
  const rows = await db
    .select({ exercise: exercises, favourite: exerciseFavourites.targetId })
    .from(exercises)
    .leftJoin(
      exerciseFavourites,
      and(
        eq(exerciseFavourites.targetId, exercises.id),
        eq(exerciseFavourites.userId, caller.userId),
      ),
    )
    .where(and(visible(exercises, caller), eq(exercises.id, id)))
    .limit(1)

  const row = rows[0]
  if (row === undefined) throw notFound('exercise')

  const [hydrated] = await hydrate(
    [row.exercise],
    new Set(row.favourite === null ? [] : [row.exercise.id]),
    caller,
  )
  if (hydrated === undefined) throw notFound('exercise')
  return hydrated
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/** Editors of the target group only. Not-an-editor and does-not-exist give the same answer. */
function assertCanWriteTo(caller: Caller, groupId: string): void {
  if (!caller.editorGroupIds.includes(groupId)) throw notFound('group')
}

async function replaceMuscles(
  tx: Transaction,
  exerciseId: string,
  muscles: ExerciseCreate['muscles'],
): Promise<void> {
  await tx.delete(exerciseMuscles).where(eq(exerciseMuscles.exerciseId, exerciseId))
  await tx
    .insert(exerciseMuscles)
    .values(muscles.map((m) => ({ exerciseId, muscleSlug: m.muscle, loadPct: m.loadPct })))
}

/**
 * Verifies EXISTENCE only — media are not ownable and carry no ACL, by design. An unknown id is a
 * 404 rather than a dangling reference. See docs/adr/0009-media-model.md.
 */
async function replaceMedia(
  tx: Transaction,
  exerciseId: string,
  mediaIds: string[],
): Promise<void> {
  await tx.delete(exerciseMedia).where(eq(exerciseMedia.exerciseId, exerciseId))
  if (mediaIds.length === 0) return

  const found = await tx.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds))
  const known = new Set(found.map((m) => m.id))
  const missing = mediaIds.filter((id) => !known.has(id))
  if (missing.length > 0) throw notFound(`media ${missing[0]}`)

  await tx
    .insert(exerciseMedia)
    .values(mediaIds.map((mediaId, sortIndex) => ({ exerciseId, mediaId, sortIndex })))
}

export async function create(
  caller: Caller,
  input: ExerciseCreate,
  ownerGroupId = caller.personalGroupId,
): Promise<Exercise> {
  assertCanWriteTo(caller, ownerGroupId)

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(exercises)
      .values({
        ownerGroupId,
        createdBy: caller.userId,
        name: input.name,
        tracking: input.tracking,
        description: input.description,
        instructions: input.instructions,
        equipment: input.equipment,
        isUnilateral: input.isUnilateral,
      })
      .returning({ id: exercises.id })
    if (created === undefined) throw new Error('Could not create the exercise')

    await replaceMuscles(tx, created.id, input.muscles)
    await replaceMedia(tx, created.id, input.mediaIds)
    return created.id
  })

  return await get(caller, id)
}

export async function update(caller: Caller, id: string, patch: ExerciseUpdate): Promise<Exercise> {
  await db.transaction(async (tx) => {
    // `editable` is what makes this a 404 rather than an edit of someone else's exercise.
    const [existing] = await tx
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(editable(exercises, caller), eq(exercises.id, id)))
      .limit(1)
    if (existing === undefined) throw notFound('exercise')

    const columns = {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.tracking !== undefined && { tracking: patch.tracking }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.instructions !== undefined && { instructions: patch.instructions }),
      ...(patch.equipment !== undefined && { equipment: patch.equipment }),
      ...(patch.isUnilateral !== undefined && { isUnilateral: patch.isUnilateral }),
    }
    // Always touch the row so `updated_at` advances even for a media-only or muscle-only change.
    await tx
      .update(exercises)
      .set({ ...columns, updatedAt: new Date() })
      .where(eq(exercises.id, id))

    if (patch.muscles !== undefined) await replaceMuscles(tx, id, patch.muscles)
    if (patch.mediaIds !== undefined) await replaceMedia(tx, id, patch.mediaIds)
  })

  return await get(caller, id)
}

export async function remove(caller: Caller, id: string): Promise<void> {
  const deleted = await db
    .delete(exercises)
    .where(and(editable(exercises, caller), eq(exercises.id, id)))
    .returning({ id: exercises.id })
  if (deleted.length === 0) throw notFound('exercise')
}

/**
 * The escape hatch from a read-only shared library: copy something you can see into somewhere you
 * can write, then edit the copy. Muscles and media links come with it; the media rows themselves
 * are shared, not duplicated, because they are immutable content-addressed blobs.
 */
export async function duplicate(caller: Caller, id: string, toGroupId?: string): Promise<Exercise> {
  const target = toGroupId ?? caller.personalGroupId
  assertCanWriteTo(caller, target)

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

/** Requires editor rights on BOTH sides: you cannot push something into a group, or out of one. */
export async function transfer(caller: Caller, id: string, toGroupId: string): Promise<Exercise> {
  assertCanWriteTo(caller, toGroupId)

  const moved = await db
    .update(exercises)
    .set({ ownerGroupId: toGroupId, updatedAt: new Date() })
    .where(and(editable(exercises, caller), eq(exercises.id, id)))
    .returning({ id: exercises.id })
  if (moved.length === 0) throw notFound('exercise')

  return await get(caller, id)
}

export async function setFavourite(caller: Caller, id: string, favourite: boolean): Promise<void> {
  // Only things the caller can SEE can be pinned — visibility, not editability.
  const [found] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(visible(exercises, caller), eq(exercises.id, id)))
    .limit(1)
  if (found === undefined) throw notFound('exercise')

  if (favourite) {
    await db
      .insert(exerciseFavourites)
      .values({ userId: caller.userId, targetId: id })
      .onConflictDoNothing()
    return
  }
  await db
    .delete(exerciseFavourites)
    .where(and(eq(exerciseFavourites.userId, caller.userId), eq(exerciseFavourites.targetId, id)))
}
