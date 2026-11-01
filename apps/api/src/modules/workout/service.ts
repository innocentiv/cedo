import { count, inArray } from 'drizzle-orm'
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
import { db } from '../../db/client.ts'
import { assertEditorOf } from '../../db/ownable.ts'
import { visibleWorkoutDays } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type Training, own } from '../coaching/training.ts'
import { toSummary } from './mapper.ts'
import { hydratePlan } from './plan.ts'
import { workoutLifecycle } from './lifecycle.ts'
import { insertCopy, insertWorkout, savePlan, updateWorkout } from './write.ts'

/** Day counts for many workouts in one grouped query, not one per workout. */
async function dayCounts(caller: Caller, workoutIds: string[]): Promise<Map<string, number>> {
  if (workoutIds.length === 0) return new Map()
  const days = visibleWorkoutDays(caller)
  const counts = await db
    .select({ workoutId: days.workoutId, days: count() })
    .from(days)
    .where(inArray(days.workoutId, workoutIds))
    .groupBy(days.workoutId)
  return new Map(counts.map((c) => [c.workoutId, c.days]))
}

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

/**
 * A workout whole, as the reader can see it — its exercises doable for the athlete the training is
 * of: the reader, or an athlete they plan for (#35).
 */
export async function get(training: Training, id: string): Promise<Workout> {
  const summary = await summaryOf(training.reader, id)
  return { ...summary, days: await hydratePlan(training.reader, id, training.athleteId) }
}

// ---------------------------------------------------------------------------------------------
// Writes — the statements live in write.ts; each answers with the workout as now read back.
// ---------------------------------------------------------------------------------------------

export async function create(
  caller: Caller,
  input: WorkoutCreate,
  ownerGroupId = caller.personalGroupId,
): Promise<Workout> {
  return await get(own(caller), await insertWorkout(caller, input, ownerGroupId))
}

export async function update(caller: Caller, id: string, patch: WorkoutUpdate): Promise<Workout> {
  await updateWorkout(caller, id, patch)
  return await get(own(caller), id)
}

export async function remove(caller: Caller, id: string): Promise<void> {
  await workoutLifecycle.remove(caller, id)
}

export async function replacePlan(caller: Caller, id: string, plan: PlanSave): Promise<Workout> {
  await savePlan(caller, id, plan)
  return await get(own(caller), id)
}

/**
 * Deep copy: the plan comes with it, since a workout without its days is not a workout. Refused
 * before anything is written if the copy could not use every exercise where it lands — the one
 * rule, `assertPlanCanUse`, in insertCopy.
 */
export async function duplicate(caller: Caller, id: string, toGroupId?: string): Promise<Workout> {
  const target = toGroupId ?? caller.personalGroupId
  assertEditorOf(caller, target)

  const source = await get(own(caller), id)
  const copyId = await insertCopy(caller, source, planInputFrom(source, { keepIds: false }), target)
  return await get(own(caller), copyId)
}

export async function transfer(caller: Caller, id: string, toGroupId: string): Promise<Workout> {
  await workoutLifecycle.transfer(caller, id, toGroupId)
  return await get(own(caller), id)
}

export async function setFavourite(caller: Caller, id: string, favourite: boolean): Promise<void> {
  await workoutLifecycle.setFavourite(caller, id, favourite)
}
