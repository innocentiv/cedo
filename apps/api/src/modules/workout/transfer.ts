import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { visible } from '../../db/ownable.ts'
import { exercises, workoutDays, workoutEntries } from '../../db/schema.ts'
import { conflict } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * Moving a workout into a group requires every exercise it references to be visible THERE.
 *
 * Otherwise sharing a plan silently shares the private exercises it uses — the group's members can
 * read a workout, and reading a workout means reading its exercises. Refusing at transfer time
 * keeps the exercise ACL honest and gives the sharer something actionable: share or duplicate the
 * exercise into the group first. The read path redacts as a second line of defence, because
 * visibility can also change after the fact. See docs/03-domain-model.md.
 */
export async function assertExercisesVisibleToGroup(
  caller: Caller,
  workoutId: string,
  toGroupId: string,
): Promise<void> {
  const referenced = await db
    .selectDistinct({
      id: exercises.id,
      name: exercises.name,
      ownerGroupId: exercises.ownerGroupId,
    })
    .from(workoutEntries)
    .innerJoin(workoutDays, eq(workoutDays.id, workoutEntries.dayId))
    .innerJoin(exercises, eq(exercises.id, workoutEntries.exerciseId))
    .where(and(eq(workoutDays.workoutId, workoutId), visible(exercises, caller)))

  const unreachable = referenced.filter((e) => e.ownerGroupId !== toGroupId)
  // An exercise already in the target group is fine; so is one in a group the target can also see.
  // Groups do not nest, so "visible to the target group" means "owned by it".
  if (unreachable.length > 0) {
    const names = unreachable.map((e) => `"${e.name}"`).join(', ')
    throw conflict(
      `That group cannot see ${names}. Share or duplicate ${unreachable.length === 1 ? 'it' : 'them'} into the group first.`,
    )
  }
}
