import { and, eq, inArray } from 'drizzle-orm'
import { DEFAULT_GROUP_SLUG } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groups } from '../../db/schema.ts'
import { visibleExercises, visibleWorkoutDays, visibleWorkoutEntries } from '../../db/visible.ts'
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

  const ids = [...new Set(exerciseIds)]
  const visible = visibleExercises(caller)
  const seen = await db
    .select({ name: visible.name, ownerGroupId: visible.ownerGroupId, library: groups.id })
    .from(visible)
    .leftJoin(groups, and(eq(groups.id, visible.ownerGroupId), eq(groups.slug, DEFAULT_GROUP_SLUG)))
    .where(inArray(visible.id, ids))

  /**
   * Only what the caller can see is named. One hidden from them is counted, never named — and it
   * is never allowed through: the caller is an editor of the target, so it cannot be owned there,
   * and it cannot be in the library they read. Filtering it out of the check, as the first version
   * did, let a transfer carry it into the group as an "Unavailable exercise" row for everyone.
   */
  const hidden = ids.length - seen.length
  if (hidden > 0) {
    throw conflict(
      `${hidden} exercise${hidden === 1 ? ' in this plan is' : 's in this plan are'} not visible ` +
        'to you, so the plan cannot be shared into that group. Ask its owner to share them, or ' +
        'remove them from the plan.',
    )
  }

  const unreachable = seen.filter((e) => e.ownerGroupId !== toGroupId && e.library === null)
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
  const entries = visibleWorkoutEntries(caller)
  const days = visibleWorkoutDays(caller)
  const referenced = await db
    .selectDistinct({ id: entries.exerciseId })
    .from(entries)
    .innerJoin(days, eq(days.id, entries.dayId))
    .where(eq(days.workoutId, workoutId))
  await assertExercisesCanTravel(
    caller,
    referenced.map((r) => r.id),
    toGroupId,
  )
}
