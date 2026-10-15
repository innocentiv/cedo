import { count, inArray } from 'drizzle-orm'
import {
  type Page,
  type Workout,
  type WorkoutCreate,
  type WorkoutPlanInput,
  type WorkoutQuery,
  type WorkoutSummary,
  type WorkoutUpdate,
  planInputFrom,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { assertEditorOf } from '../../db/ownable.ts'
import { visibleExercises, visibleWorkoutDays } from '../../db/visible.ts'
import { conflict, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { hydratePlan, toSummary } from './mapper.ts'
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

export async function get(caller: Caller, id: string): Promise<Workout> {
  const summary = await summaryOf(caller, id)
  return { ...summary, days: await hydratePlan(caller, id) }
}

// ---------------------------------------------------------------------------------------------
// Writes — the statements live in write.ts; each answers with the workout as now read back.
// ---------------------------------------------------------------------------------------------

export async function create(
  caller: Caller,
  input: WorkoutCreate,
  ownerGroupId = caller.personalGroupId,
): Promise<Workout> {
  return await get(caller, await insertWorkout(caller, input, ownerGroupId))
}

export async function update(caller: Caller, id: string, patch: WorkoutUpdate): Promise<Workout> {
  await updateWorkout(caller, id, patch)
  return await get(caller, id)
}

export async function remove(caller: Caller, id: string): Promise<void> {
  await workoutLifecycle.remove(caller, id)
}

export async function replacePlan(
  caller: Caller,
  id: string,
  plan: WorkoutPlanInput,
): Promise<Workout> {
  await assertExercisesVisible(caller, plan)
  await savePlan(caller, id, plan)
  return await get(caller, id)
}

/**
 * Every referenced exercise must be VISIBLE to the caller. Without this a workout could reference
 * an exercise the caller cannot see, and then leak its name and description straight back through
 * `GET /workouts/:id`.
 */
async function assertExercisesVisible(caller: Caller, plan: WorkoutPlanInput): Promise<void> {
  const ids = [...new Set(plan.days.flatMap((d) => d.entries.map((e) => e.exerciseId)))]
  if (ids.length === 0) return

  const visible = visibleExercises(caller)
  const found = await db.select({ id: visible.id }).from(visible).where(inArray(visible.id, ids))

  const known = new Set(found.map((e) => e.id))
  const missing = ids.filter((exerciseId) => !known.has(exerciseId))
  if (missing.length > 0) throw notFound(`exercise ${missing[0]}`)
}

/**
 * Deep copy: the plan comes with it, since a workout without its days is not a workout.
 *
 * Refused before anything is written if the caller cannot see every exercise — a copy may not
 * reference what its owner cannot read. The refusal counts the hidden exercises and names none.
 */
export async function duplicate(caller: Caller, id: string, toGroupId?: string): Promise<Workout> {
  const target = toGroupId ?? caller.personalGroupId
  assertEditorOf(caller, target)

  const source = await get(caller, id)
  const hidden = source.days.flatMap((d) => d.entries).filter((e) => e.exercise === null).length
  if (hidden > 0) {
    throw conflict(
      `${hidden} exercise${hidden === 1 ? ' in this plan is' : 's in this plan are'} no longer ` +
        'visible to you, so it cannot be copied. Ask its owner to share them, or copy the plan without them.',
    )
  }

  // `get` already resolved every exercise through the visible relation — the count above IS the
  // visibility check. Whether they may live in the TARGET group is the transfer rule, in insertCopy.
  const copyId = await insertCopy(caller, source, planInputFrom(source, { keepIds: false }), target)
  return await get(caller, copyId)
}

export async function transfer(caller: Caller, id: string, toGroupId: string): Promise<Workout> {
  await workoutLifecycle.transfer(caller, id, toGroupId)
  return await get(caller, id)
}

export async function setFavourite(caller: Caller, id: string, favourite: boolean): Promise<void> {
  await workoutLifecycle.setFavourite(caller, id, favourite)
}
