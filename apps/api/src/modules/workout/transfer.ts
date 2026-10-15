import { and, eq, inArray, ne, notInArray } from 'drizzle-orm'
import { DEFAULT_GROUP_SLUG } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visible } from '../../db/ownable.ts'
import { exercises, groups, workoutDays, workoutEntries } from '../../db/schema.ts'
import { conflict } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * A plan placed in a group — moved there, or copied there — may only use exercises every member
 * of that group can read, NOW AND LATER.
 *
 * Otherwise sharing a plan silently shares the private exercises it uses, or hands members a plan
 * of "Unavailable exercise" rows. Refusing gives the sharer something actionable: share or
 * duplicate the exercise into the group first. The read path redacts as a second line of defence,
 * because visibility can still change after the fact. See docs/03-domain-model.md.
 *
 * The rule, and why it is not "every current member can read it": membership changes. Judged on
 * the members at the moment of transfer, a group holding only its creator accepted anything, and
 * everyone added afterwards got the unavailable rows. So an exercise may travel when it is owned by
 * the target group itself, or by the starter library, which every account joins at registration.
 * Into the caller's PERSONAL group, which nobody else will ever join, seeing it is enough.
 */
export async function assertExercisesCanTravel(
  caller: Caller,
  exerciseIds: readonly string[],
  toGroupId: string,
): Promise<void> {
  if (toGroupId === caller.personalGroupId || exerciseIds.length === 0) return

  const library = db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.slug, DEFAULT_GROUP_SLUG))
  const unreachable = await db
    .select({ name: exercises.name })
    .from(exercises)
    .where(
      and(
        inArray(exercises.id, [...new Set(exerciseIds)]),
        // Only what the caller can see is named. An exercise hidden from them is the caller's
        // problem to report without naming — see `duplicate`.
        visible(exercises, caller),
        ne(exercises.ownerGroupId, toGroupId),
        notInArray(exercises.ownerGroupId, library),
      ),
    )

  if (unreachable.length > 0) {
    const names = unreachable.map((e) => `"${e.name}"`).join(', ')
    throw conflict(
      `That group cannot see ${names}. Share or duplicate ${unreachable.length === 1 ? 'it' : 'them'} into the group first.`,
    )
  }
}

/** The transfer form: the exercises are whatever the stored plan references. */
export async function assertWorkoutCanTravel(
  caller: Caller,
  workoutId: string,
  toGroupId: string,
): Promise<void> {
  const referenced = await db
    .selectDistinct({ id: workoutEntries.exerciseId })
    .from(workoutEntries)
    .innerJoin(workoutDays, eq(workoutDays.id, workoutEntries.dayId))
    .where(eq(workoutDays.workoutId, workoutId))
  await assertExercisesCanTravel(
    caller,
    referenced.map((r) => r.id),
    toGroupId,
  )
}
