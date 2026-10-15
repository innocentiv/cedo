import { and, eq, inArray, sql } from 'drizzle-orm'
import type { ExerciseCreate, ExerciseUpdate } from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { editable } from '../../db/ownable.ts'
import {
  exerciseFavourites,
  exerciseMedia,
  exerciseMuscles,
  exercises,
  media,
} from '../../db/schema.ts'
import { conflict, isForeignKeyRefusal, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * Every statement that changes an exercise. A write file may import the raw tables — a subquery
 * cannot be an UPDATE target — and in exchange every statement here carries `editable()`, or runs
 * inside a transaction that locked an editable parent first. Reads belong in `service.ts`, through
 * the visible relations. See docs/adr/0019-visible-relations.md.
 */

/** Editors of the target group only. Not-an-editor and does-not-exist give the same answer. */
export function assertCanWriteTo(caller: Caller, groupId: string): void {
  if (!caller.editorGroupIds.includes(groupId)) throw notFound('group')
}

/** The exercise a child row belongs to, and the owner it therefore carries. */
interface Parent {
  readonly id: string
  readonly ownerGroupId: string
}

async function replaceMuscles(
  tx: Transaction,
  caller: Caller,
  exercise: Parent,
  muscles: ExerciseCreate['muscles'],
): Promise<void> {
  await tx
    .delete(exerciseMuscles)
    .where(and(editable(exerciseMuscles, caller), eq(exerciseMuscles.exerciseId, exercise.id)))
  await tx.insert(exerciseMuscles).values(
    muscles.map((m) => ({
      exerciseId: exercise.id,
      ownerGroupId: exercise.ownerGroupId,
      muscleSlug: m.muscle,
      loadPct: m.loadPct,
    })),
  )
}

/**
 * Verifies EXISTENCE only — media are not ownable and carry no ACL, by design. An unknown id is a
 * 404 rather than a dangling reference. See docs/adr/0009-media-model.md.
 */
async function replaceMedia(
  tx: Transaction,
  caller: Caller,
  exercise: Parent,
  mediaIds: string[],
): Promise<void> {
  await tx
    .delete(exerciseMedia)
    .where(and(editable(exerciseMedia, caller), eq(exerciseMedia.exerciseId, exercise.id)))
  if (mediaIds.length === 0) return

  const found = await tx.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds))
  const known = new Set(found.map((m) => m.id))
  const missing = mediaIds.filter((id) => !known.has(id))
  if (missing.length > 0) throw notFound(`media ${missing[0]}`)

  await tx.insert(exerciseMedia).values(
    mediaIds.map((mediaId, sortIndex) => ({
      exerciseId: exercise.id,
      ownerGroupId: exercise.ownerGroupId,
      mediaId,
      sortIndex,
    })),
  )
}

/** Returns the new exercise's id. */
export async function insertExercise(
  caller: Caller,
  input: ExerciseCreate,
  ownerGroupId: string,
): Promise<string> {
  assertCanWriteTo(caller, ownerGroupId)

  return await db.transaction(async (tx) => {
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
      .returning({ id: exercises.id, ownerGroupId: exercises.ownerGroupId })
    if (created === undefined) throw new Error('Could not create the exercise')

    await replaceMuscles(tx, caller, created, input.muscles)
    await replaceMedia(tx, caller, created, input.mediaIds)
    return created.id
  })
}

export async function updateExercise(
  caller: Caller,
  id: string,
  patch: ExerciseUpdate,
): Promise<void> {
  await db.transaction(async (tx) => {
    /**
     * `editable` is what makes this a 404 rather than an edit of someone else's exercise — and the
     * row is LOCKED, not merely read.
     *
     * The transaction is READ COMMITTED, so an unlocked guard SELECT is a check-then-act: a
     * co-editor calling `transfer` between this statement and the UPDATE below moves the exercise
     * into a group the caller is not in, and the writes then land on a row they no longer have any
     * rights to. `for('update')` holds it until this transaction commits. Invariant 5 asks for
     * `editable()` on the write itself; here the writes are three statements against children, so
     * the lock is what makes the guard binding on all of them. See docs/02-conventions.md.
     */
    const [existing] = await tx
      .select({ id: exercises.id, ownerGroupId: exercises.ownerGroupId })
      .from(exercises)
      .where(and(editable(exercises, caller), eq(exercises.id, id)))
      .limit(1)
      .for('update')
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
      .set({ ...columns, updatedAt: sql`now()` })
      .where(and(editable(exercises, caller), eq(exercises.id, id)))

    if (patch.muscles !== undefined) await replaceMuscles(tx, caller, existing, patch.muscles)
    if (patch.mediaIds !== undefined) await replaceMedia(tx, caller, existing, patch.mediaIds)
  })
}

/**
 * Plans and logged history reference exercises ON DELETE RESTRICT, so an exercise in use cannot go.
 * The database is the check — a count beforehand would race a concurrent log — and its refusal is
 * a 409, not a 500. The message names nothing: what references it may belong to people the caller
 * cannot see.
 */
export async function deleteExercise(caller: Caller, id: string): Promise<void> {
  const deleted = await db
    .delete(exercises)
    .where(and(editable(exercises, caller), eq(exercises.id, id)))
    .returning({ id: exercises.id })
    .catch((error: unknown) => {
      if (isForeignKeyRefusal(error)) {
        throw conflict(
          'That exercise is used by a plan or by logged history, so it cannot be deleted. ' +
            'Remove it from the plans that use it; logged history keeps it for good.',
        )
      }
      throw error
    })
  if (deleted.length === 0) throw notFound('exercise')
}

/**
 * Requires editor rights on BOTH sides: you cannot push something into a group, or out of one. Its
 * muscles and media follow by the cascading owner key.
 */
export async function transferExercise(
  caller: Caller,
  id: string,
  toGroupId: string,
): Promise<void> {
  assertCanWriteTo(caller, toGroupId)

  const moved = await db
    .update(exercises)
    .set({ ownerGroupId: toGroupId, updatedAt: sql`now()` })
    .where(and(editable(exercises, caller), eq(exercises.id, id)))
    .returning({ id: exercises.id })
  if (moved.length === 0) throw notFound('exercise')
}

/** Pins or unpins. Whether the caller may see the exercise is the service's check, made first. */
export async function writeFavourite(
  caller: Caller,
  id: string,
  favourite: boolean,
): Promise<void> {
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
