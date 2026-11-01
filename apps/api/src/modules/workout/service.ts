import {
  type Page,
  type Workout,
  type WorkoutCreate,
  type PlanSave,
  type WorkoutQuery,
  type WorkoutSummary,
  type WorkoutUpdate,
  planInputFrom,
} from '@cedo/contract'
import { assertEditorOf } from '../../db/ownable.ts'
import type { Caller } from '../../plugins/auth.ts'
import type { Training } from '../coaching/training.ts'
import { toSummary } from './mapper.ts'
import { dayCounts, hydratePlan } from './plan.ts'
import { workoutLifecycle } from './lifecycle.ts'
import { insertCopy, insertWorkout, savePlan, updateWorkout } from './write.ts'

export async function list(caller: Caller, query: WorkoutQuery): Promise<Page<WorkoutSummary>> {
  const page = await workoutLifecycle.list(caller, query)
  const dayCount = await dayCounts(
    caller,
    page.items.map((i) => i.row.id),
  )
  return {
    items: page.items.map((i) =>
      toSummary(i.row, dayCount.get(i.row.id) ?? 0, i.isFavourite, caller),
    ),
    nextCursor: page.nextCursor,
  }
}

async function summaryOf(caller: Caller, id: string): Promise<WorkoutSummary> {
  const { row, isFavourite } = await workoutLifecycle.get(caller, id)
  const days = await dayCounts(caller, [id])
  return toSummary(row, days.get(id) ?? 0, isFavourite, caller)
}

/** A workout whole, as `reader` can see it, its exercises judged doable for `judgedFor` (#35). */
async function whole(reader: Caller, id: string, judgedFor: string): Promise<Workout> {
  const summary = await summaryOf(reader, id)
  return { ...summary, days: await hydratePlan(reader, id, judgedFor) }
}

/**
 * A workout whole, as the reader can see it — its exercises doable for the athlete the training is
 * of: the reader, or an athlete they plan for.
 */
export const get = async (training: Training, id: string): Promise<Workout> =>
  await whole(training.reader, id, training.athleteId)

/** A workout read for the caller themself — one they wrote, or copy — judged by their equipment. */
const readOwn = async (caller: Caller, id: string): Promise<Workout> =>
  await whole(caller, id, caller.userId)

// ---------------------------------------------------------------------------------------------
// Writes — the statements live in write.ts; each answers with the workout as now read back.
// ---------------------------------------------------------------------------------------------

export async function create(
  caller: Caller,
  input: WorkoutCreate,
  ownerGroupId = caller.personalGroupId,
): Promise<Workout> {
  return await readOwn(caller, await insertWorkout(caller, input, ownerGroupId))
}

export async function update(caller: Caller, id: string, patch: WorkoutUpdate): Promise<Workout> {
  await updateWorkout(caller, id, patch)
  return await readOwn(caller, id)
}

export async function remove(caller: Caller, id: string): Promise<void> {
  await workoutLifecycle.remove(caller, id)
}

export async function replacePlan(caller: Caller, id: string, plan: PlanSave): Promise<Workout> {
  await savePlan(caller, id, plan)
  return await readOwn(caller, id)
}

/**
 * Deep copy: the plan comes with it, since a workout without its days is not a workout. Refused
 * before anything is written if the copy could not use every exercise where it lands — the one
 * rule, `assertPlanCanUse`, in insertCopy.
 */
export async function duplicate(caller: Caller, id: string, toGroupId?: string): Promise<Workout> {
  const target = toGroupId ?? caller.personalGroupId
  assertEditorOf(caller, target)

  const source = await readOwn(caller, id)
  const copyId = await insertCopy(caller, source, planInputFrom(source, { keepIds: false }), target)
  return await readOwn(caller, copyId)
}

export async function transfer(caller: Caller, id: string, toGroupId: string): Promise<Workout> {
  await workoutLifecycle.transfer(caller, id, toGroupId)
  return await readOwn(caller, id)
}

export async function setFavourite(caller: Caller, id: string, favourite: boolean): Promise<void> {
  await workoutLifecycle.setFavourite(caller, id, favourite)
}
