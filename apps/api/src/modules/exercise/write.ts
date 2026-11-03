import { and, eq, inArray, sql } from 'drizzle-orm'
import type { ExerciseCreate, ExerciseUpdate, TrackingMode } from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { type OwnedRow, assertEditorOf, editable } from '../../db/ownable.ts'
import { exerciseMedia, exerciseMuscles, exercises, media } from '../../db/schema.ts'
import { invalid, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

const TRACKING_FIXED =
  'How an exercise is measured is fixed once it exists: duplicate it to track it differently'

/**
 * How an exercise is measured is fixed once it exists (ADR-0026): plans and logs measured one way
 * would be left measured another, and a rule that fit would stop fitting. Sent back unchanged — the
 * edit form sends the whole exercise — is no change.
 */
function assertTrackingKept(patch: ExerciseUpdate, stored: TrackingMode): void {
  if (patch.tracking === undefined || patch.tracking === stored) return
  throw invalid(TRACKING_FIXED, [{ path: 'tracking', message: TRACKING_FIXED }])
}

/**
 * An exercise's own writes — create and update, with its muscles and media — and the guards that
 * must run in the same transaction. Transfer, delete and favourites are the shared lifecycle
 * (`lifecycle.ts`).
 *
 * A write file may import the raw tables — a subquery cannot be an UPDATE target — and in exchange
 * every statement here on an owned table carries `editable()`. Every other read goes through the
 * visible relations. See docs/adr/0019-visible-relations.md.
 */

async function replaceMuscles(
  tx: Transaction,
  caller: Caller,
  exercise: OwnedRow,
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
  exercise: OwnedRow,
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
  assertEditorOf(caller, ownerGroupId)

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
     * rights to. `for('update')` holds it until this transaction commits, so the owner read here is
     * the one the children below are written under. Each of those statements carries `editable()`
     * as well. See docs/02-conventions.md.
     */
    const [existing] = await tx
      .select({
        id: exercises.id,
        ownerGroupId: exercises.ownerGroupId,
        tracking: exercises.tracking,
      })
      .from(exercises)
      .where(and(editable(exercises, caller), eq(exercises.id, id)))
      .limit(1)
      .for('update')
    if (existing === undefined) throw notFound('exercise')
    assertTrackingKept(patch, existing.tracking)

    const columns = {
      ...(patch.name !== undefined && { name: patch.name }),
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
