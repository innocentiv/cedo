import { and, eq, inArray } from 'drizzle-orm'
import {
  DEFAULT_GROUP_SLUG,
  type TrackingMode,
  type WorkoutPlanInput,
  weightAllowed,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groups } from '../../db/schema.ts'
import { visibleExercises } from '../../db/visible.ts'
import { conflict, notFound } from '../../lib/error.ts'
import { assistanceRefused } from '../session/loggable.ts'
import type { Caller } from '../../plugins/auth.ts'
import { planEntries } from './plan.ts'

/**
 * Where the exercise ids came from, which decides only how a refusal is said: an id the REQUEST
 * named and the caller cannot see is a 404, like any other id they cannot see; one the STORED plan
 * carries is a 409 — the plan exists, it just cannot go there. Which of the two the stored plan is
 * being asked to do decides the words: a plan being MOVED, by an editor who may remove the
 * exercise from it, or COPIED, quite possibly by a reader, who may not.
 */
export type ReferencedBy = 'request' | 'transfer' | 'copy'

/**
 * The one rule for which exercises a plan may use in a group — saved there, copied there, or transferred
 * there. It was three checks that disagreed: saving and duplicating refused an exercise the caller
 * cannot see, while transferring into their personal group returned early and let it through, to
 * become an "Unavailable exercise" row.
 *
 * 1. Every exercise must be VISIBLE to the caller. Otherwise a plan references what its owner cannot
 *    read, and `GET /workouts/:id` can only redact it.
 * 2. In a shared group, every exercise must also be readable by every member, NOW AND LATER:
 *    owned by that group, or by the starter library, which every account joins at registration.
 *    Judged on the current members instead, a group holding only its creator accepted anything,
 *    and everyone added afterwards got the unavailable rows. Into the caller's personal group,
 *    which nobody else will ever join, (1) is enough.
 *
 * Refusing gives the caller something actionable: share or duplicate the exercise into the group
 * first. The read path redacts as a second line of defence, because visibility can still change
 * after the fact. See docs/03-domain-model.md.
 */
export async function assertPlanCanUse(
  caller: Caller,
  exerciseIds: readonly string[],
  groupId: string,
  referencedBy: ReferencedBy,
): Promise<ReadonlyMap<string, TrackingMode>> {
  const ids = [...new Set(exerciseIds)]
  if (ids.length === 0) return new Map()

  const visible = visibleExercises(caller)
  const seen = await db
    .select({
      id: visible.id,
      name: visible.name,
      tracking: visible.tracking,
      ownerGroupId: visible.ownerGroupId,
      library: groups.id,
    })
    .from(visible)
    .leftJoin(groups, and(eq(groups.id, visible.ownerGroupId), eq(groups.slug, DEFAULT_GROUP_SLUG)))
    .where(inArray(visible.id, ids))

  // Returned, read here anyway: how each is measured, for what the plan may prescribe it (#19).
  const tracking = new Map(seen.map((e) => [e.id, e.tracking]))
  const hidden = ids.filter((id) => !tracking.has(id))
  if (hidden.length > 0) throw refusedHidden(hidden, referencedBy)
  if (groupId === caller.personalGroupId) return tracking

  const unreachable = seen.filter((e) => e.ownerGroupId !== groupId && e.library === null)
  if (unreachable.length > 0) {
    const names = unreachable.map((e) => `"${e.name}"`).join(', ')
    throw conflict(
      `That group cannot see ${names}. Share or duplicate ${unreachable.length === 1 ? 'it' : 'them'} into the group first.`,
    )
  }
  return tracking
}

/**
 * Counted, never named — the caller cannot read the name. The id is no secret: the request sent
 * it, or the plan already shows it on the entry whose exercise reads as null.
 */
function refusedHidden(hidden: readonly string[], referencedBy: ReferencedBy) {
  if (referencedBy === 'request') return notFound(`exercise ${hidden[0]}`)
  const n = hidden.length
  const [them, these] = n === 1 ? ['it', ' in this plan is'] : ['them', 's in this plan are']
  const unseen = `${n} exercise${these} not visible to you`
  return conflict(
    referencedBy === 'copy'
      ? `${unseen}, so the plan cannot be copied. Ask its owner to share ${them} with you.`
      : `${unseen}, so the plan cannot be moved there. ` +
          `Ask its owner to share ${them} with you, or remove ${them} from the plan.`,
  )
}

/**
 * A negative target weight is assistance, which only a bodyweight movement takes (#19). Over the
 * modes `assertPlanCanUse` has already read, so it costs the save no query of its own.
 */
export function assertAssistanceAllowed(
  plan: WorkoutPlanInput,
  tracking: ReadonlyMap<string, TrackingMode>,
): void {
  plan.days.forEach((day, d) => {
    day.entries.forEach((entry, e) => {
      const mode = tracking.get(entry.exerciseId)
      const s = entry.sets.findIndex(
        (set) => mode !== undefined && !weightAllowed(set.targetWeightG, mode),
      )
      if (s === -1) return
      throw assistanceRefused(`days.${d}.entries.${e}.sets.${s}.targetWeightG`)
    })
  })
}

/** Before a transfer: the one rule, over whatever exercises the stored plan references. */
export async function assertWorkoutCanTransferTo(
  caller: Caller,
  workoutId: string,
  toGroupId: string,
): Promise<void> {
  const entries = planEntries(caller, workoutId)
  const referenced = await db.selectDistinct({ id: entries.exerciseId }).from(entries)
  await assertPlanCanUse(
    caller,
    referenced.map((r) => r.id),
    toGroupId,
    'transfer',
  )
}
