import { and, eq, exists, ne, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../db/client.ts'
import { visible } from '../../db/ownable.ts'
import { exercises, groupMembers, workoutDays, workoutEntries } from '../../db/schema.ts'
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
  const unreachable = await db
    .selectDistinct({ id: exercises.id, name: exercises.name })
    .from(workoutEntries)
    .innerJoin(workoutDays, eq(workoutDays.id, workoutEntries.dayId))
    .innerJoin(exercises, eq(exercises.id, workoutEntries.exerciseId))
    .where(
      and(
        eq(workoutDays.workoutId, workoutId),
        visible(exercises, caller),
        hiddenFromSomeMemberOf(toGroupId),
      ),
    )

  if (unreachable.length > 0) {
    const names = unreachable.map((e) => `"${e.name}"`).join(', ')
    throw conflict(
      `That group cannot see ${names}. Share or duplicate ${unreachable.length === 1 ? 'it' : 'them'} into the group first.`,
    )
  }
}

/**
 * True for an exercise some member of `groupId` cannot read. It may travel with a plan only when
 * EVERY member already reads it: it is in that group, or in a group all of them belong to — the
 * starter library, which everyone reads, being the everyday case. Requiring the target group to OWN
 * each exercise refused every plan built from the library.
 *
 * "Some member lacks a membership in the exercise's group", correlated on the outer `exercises`
 * row, so the check stays one query however many exercises the plan uses.
 */
function hiddenFromSomeMemberOf(groupId: string) {
  const target = alias(groupMembers, 'target')
  const owner = alias(groupMembers, 'owner')
  return and(
    ne(exercises.ownerGroupId, groupId),
    exists(
      db
        .select({ one: sql`1` })
        .from(target)
        .where(
          and(
            eq(target.groupId, groupId),
            notExists(
              db
                .select({ one: sql`1` })
                .from(owner)
                .where(
                  and(eq(owner.groupId, exercises.ownerGroupId), eq(owner.userId, target.userId)),
                ),
            ),
          ),
        ),
    ),
  )
}
