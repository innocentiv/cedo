import { and, eq, sql } from 'drizzle-orm'
import type { WorkoutCreate, WorkoutPlanInput, WorkoutUpdate } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { assertEditorOf, editable } from '../../db/ownable.ts'
import { workoutFavourites, workouts } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { assertExercisesCanTravel, assertWorkoutCanTravel } from './transfer.ts'
import { writePlan } from './write-plan.ts'

/**
 * Every statement that changes a workout, except the plan diff itself, which is `write-plan.ts`. A
 * write file may import the raw tables — a subquery cannot be an UPDATE target — and in exchange
 * every statement here carries `editable()`. Reads belong in `service.ts`, through the visible
 * relations. See docs/adr/0019-visible-relations.md.
 */

/** Returns the new workout's id. */
export async function insertWorkout(
  caller: Caller,
  input: WorkoutCreate,
  ownerGroupId: string,
): Promise<string> {
  assertEditorOf(caller, ownerGroupId)

  const [created] = await db
    .insert(workouts)
    .values({ ownerGroupId, createdBy: caller.userId, name: input.name, notes: input.notes })
    .returning({ id: workouts.id })
  if (created === undefined) throw new Error('Could not create the workout')
  return created.id
}

export async function updateWorkout(
  caller: Caller,
  id: string,
  patch: WorkoutUpdate,
): Promise<void> {
  const columns = {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.notes !== undefined && { notes: patch.notes }),
  }

  // `editable()` on the statement itself, not merely on a guard SELECT. See docs/02-conventions.md.
  const written = await db
    .update(workouts)
    .set({ ...columns, updatedAt: sql`now()` })
    .where(and(editable(workouts, caller), eq(workouts.id, id)))
    .returning({ id: workouts.id })
  if (written.length === 0) throw notFound('workout')
}

export async function deleteWorkout(caller: Caller, id: string): Promise<void> {
  const deleted = await db
    .delete(workouts)
    .where(and(editable(workouts, caller), eq(workouts.id, id)))
    .returning({ id: workouts.id })
  if (deleted.length === 0) throw notFound('workout')
}

/**
 * Replaces the ENTIRE plan in one transaction.
 *
 * Granular CRUD over days, entries and sets would need reorder endpoints, index-collision handling
 * and partial-failure states. A transactional replace is one endpoint, one MCP tool, atomic
 * reordering — and it matches how the editor actually works. Indices come from array position, so
 * the client never sends one. See docs/06-api.md.
 */
export async function savePlan(caller: Caller, id: string, plan: WorkoutPlanInput): Promise<void> {
  await db.transaction(async (tx) => {
    /**
     * The permission check is INSIDE the transaction and takes a row lock.
     *
     * Checked outside it, this was a check-then-act on the endpoint that rewrites the most data: a
     * co-editor transferring the workout away — or an admin removing the caller's membership —
     * between the guard and the delete left the entire plan replaced by someone who no longer had
     * rights to it. `for('update')` holds the row until this commits. See docs/02-conventions.md.
     */
    const [own] = await tx
      .select({ ownerGroupId: workouts.ownerGroupId })
      .from(workouts)
      .where(and(editable(workouts, caller), eq(workouts.id, id)))
      .limit(1)
      .for('update')
    if (own === undefined) throw notFound('workout')

    // Saving is the third way an exercise reaches a group, after transfer and duplicate, and is
    // held to their rule: in a shared group, a private exercise would be an "Unavailable exercise"
    // row for every other member. Against the owner read under the lock, so a concurrent transfer
    // cannot move the target between the check and the write.
    await assertExercisesCanTravel(
      caller,
      plan.days.flatMap((d) => d.entries.map((e) => e.exerciseId)),
      own.ownerGroupId,
    )

    await writePlan(tx, caller, { id, ownerGroupId: own.ownerGroupId }, plan)
    await tx
      .update(workouts)
      .set({ updatedAt: sql`now()` })
      .where(and(editable(workouts, caller), eq(workouts.id, id)))
  })
}

/**
 * The copy and its plan in ONE transaction. The first version created the workout, then failed on
 * its plan, and left an empty copy behind on every retry. Returns the copy's id.
 */
export async function insertCopy(
  caller: Caller,
  source: { readonly name: string; readonly notes: string | null },
  plan: WorkoutPlanInput,
  toGroupId: string,
): Promise<string> {
  assertEditorOf(caller, toGroupId)
  await assertExercisesCanTravel(
    caller,
    plan.days.flatMap((d) => d.entries.map((e) => e.exerciseId)),
    toGroupId,
  )

  return await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workouts)
      .values({
        ownerGroupId: toGroupId,
        createdBy: caller.userId,
        name: source.name,
        notes: source.notes,
      })
      .returning({ id: workouts.id, ownerGroupId: workouts.ownerGroupId })
    if (created === undefined) throw new Error('Could not create the workout')
    if (plan.days.length > 0) await writePlan(tx, caller, created, plan)
    return created.id
  })
}

/** Its days, entries and sets follow by the cascading owner key. */
export async function transferWorkout(
  caller: Caller,
  id: string,
  toGroupId: string,
): Promise<void> {
  assertEditorOf(caller, toGroupId)

  /**
   * Establish that the caller may edit THIS workout before saying anything about its contents.
   *
   * `assertWorkoutCanTravel` throws a 409 naming the exercises that would be left behind,
   * which is helpful to an owner and an oracle to anyone else: running it first let a stranger
   * transfer-probe any id and learn both that the workout exists and what it prescribes, while
   * `GET /workouts/:id` correctly answered 404. The write below carries `editable()` too — this is
   * about WHICH error comes back, and 404 has to win.
   */
  const [own] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(editable(workouts, caller), eq(workouts.id, id)))
    .limit(1)
  if (own === undefined) throw notFound('workout')

  await assertWorkoutCanTravel(caller, id, toGroupId)

  const moved = await db
    .update(workouts)
    .set({ ownerGroupId: toGroupId, updatedAt: sql`now()` })
    .where(and(editable(workouts, caller), eq(workouts.id, id)))
    .returning({ id: workouts.id })
  if (moved.length === 0) throw notFound('workout')
}

/** Pins or unpins. Whether the caller may see the workout is the service's check, made first. */
export async function writeFavourite(
  caller: Caller,
  id: string,
  favourite: boolean,
): Promise<void> {
  if (favourite) {
    await db
      .insert(workoutFavourites)
      .values({ userId: caller.userId, targetId: id })
      .onConflictDoNothing()
    return
  }
  await db
    .delete(workoutFavourites)
    .where(and(eq(workoutFavourites.userId, caller.userId), eq(workoutFavourites.targetId, id)))
}
