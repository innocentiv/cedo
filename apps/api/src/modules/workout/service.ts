import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import type {
  Page,
  Workout,
  WorkoutCreate,
  WorkoutPlanInput,
  WorkoutQuery,
  WorkoutSummary,
  WorkoutUpdate,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { editable, visible } from '../../db/ownable.ts'
import { exercises, workoutDays, workoutFavourites, workouts } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { hydratePlan, toSummary } from './mapper.ts'
import { insertPlan } from './plan.ts'
import { encodeCursor, listConditions } from './query.ts'

export async function list(caller: Caller, query: WorkoutQuery): Promise<Page<WorkoutSummary>> {
  const rows = await db
    .select({ workout: workouts, favourite: workoutFavourites.targetId })
    .from(workouts)
    .leftJoin(
      workoutFavourites,
      and(eq(workoutFavourites.targetId, workouts.id), eq(workoutFavourites.userId, caller.userId)),
    )
    .where(and(...listConditions(caller, query)))
    .orderBy(asc(workouts.name), asc(workouts.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = rows.slice(0, query.limit)
  const last = items.at(-1)

  // Day counts for the whole page in one grouped query, not one per workout.
  const counts =
    items.length === 0
      ? []
      : await db
          .select({ workoutId: workoutDays.workoutId, days: count() })
          .from(workoutDays)
          .where(
            inArray(
              workoutDays.workoutId,
              items.map((r) => r.workout.id),
            ),
          )
          .groupBy(workoutDays.workoutId)
  const dayCount = new Map(counts.map((c) => [c.workoutId, c.days]))

  return {
    items: items.map((r) =>
      toSummary(r.workout, dayCount.get(r.workout.id) ?? 0, r.favourite !== null, caller),
    ),
    nextCursor:
      hasMore && last !== undefined ? encodeCursor(last.workout.name, last.workout.id) : null,
  }
}

async function summaryOf(caller: Caller, id: string): Promise<WorkoutSummary> {
  const rows = await db
    .select({ workout: workouts, favourite: workoutFavourites.targetId })
    .from(workouts)
    .leftJoin(
      workoutFavourites,
      and(eq(workoutFavourites.targetId, workouts.id), eq(workoutFavourites.userId, caller.userId)),
    )
    .where(and(visible(workouts, caller), eq(workouts.id, id)))
    .limit(1)

  const row = rows[0]
  if (row === undefined) throw notFound('workout')

  const [days] = await db
    .select({ days: count() })
    .from(workoutDays)
    .where(eq(workoutDays.workoutId, id))

  return toSummary(row.workout, days?.days ?? 0, row.favourite !== null, caller)
}

export async function get(caller: Caller, id: string): Promise<Workout> {
  const summary = await summaryOf(caller, id)
  return { ...summary, days: await hydratePlan(id, caller) }
}

export async function create(
  caller: Caller,
  input: WorkoutCreate,
  ownerGroupId = caller.personalGroupId,
): Promise<Workout> {
  if (!caller.editorGroupIds.includes(ownerGroupId)) throw notFound('group')

  const [created] = await db
    .insert(workouts)
    .values({ ownerGroupId, createdBy: caller.userId, name: input.name, notes: input.notes })
    .returning({ id: workouts.id })
  if (created === undefined) throw new Error('Could not create the workout')

  return await get(caller, created.id)
}

export async function update(caller: Caller, id: string, patch: WorkoutUpdate): Promise<Workout> {
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

  return await get(caller, id)
}

export async function remove(caller: Caller, id: string): Promise<void> {
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
export async function replacePlan(
  caller: Caller,
  id: string,
  plan: WorkoutPlanInput,
): Promise<Workout> {
  const editableRows = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(editable(workouts, caller), eq(workouts.id, id)))
    .limit(1)
  if (editableRows.length === 0) throw notFound('workout')

  await assertExercisesVisible(caller, plan)

  await db.transaction(async (tx) => {
    // Days cascade to entries, which cascade to sets.
    await tx.delete(workoutDays).where(eq(workoutDays.workoutId, id))
    await insertPlan(tx, id, plan)
    await tx
      .update(workouts)
      .set({ updatedAt: sql`now()` })
      .where(eq(workouts.id, id))
  })

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

  const found = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(visible(exercises, caller), inArray(exercises.id, ids)))

  const known = new Set(found.map((e) => e.id))
  const missing = ids.filter((exerciseId) => !known.has(exerciseId))
  if (missing.length > 0) throw notFound(`exercise ${missing[0]}`)
}

/** Deep copy: the plan comes with it, since a workout without its days is not a workout. */
export async function duplicate(caller: Caller, id: string, toGroupId?: string): Promise<Workout> {
  const target = toGroupId ?? caller.personalGroupId
  if (!caller.editorGroupIds.includes(target)) throw notFound('group')

  const source = await get(caller, id)

  const copy = await create(caller, { name: source.name, notes: source.notes }, target)
  if (source.days.length === 0) return copy

  return await replacePlan(caller, copy.id, {
    days: source.days.map((day) => ({
      name: day.name,
      entries: day.entries.map((entry) => ({
        exerciseId: entry.exerciseId,
        supersetGroup: entry.supersetGroup,
        restSeconds: entry.restSeconds,
        progression: entry.progression,
        sets: entry.sets.map((set) => ({
          targetReps: set.target.reps,
          targetWeightG: set.target.weightG,
          targetRpe: set.target.rpe,
          targetDurationS: set.target.durationS,
          targetDistanceMm: set.target.distanceMm,
          isWarmup: set.isWarmup,
        })),
      })),
    })),
  })
}

export async function transfer(caller: Caller, id: string, toGroupId: string): Promise<Workout> {
  if (!caller.editorGroupIds.includes(toGroupId)) throw notFound('group')

  const moved = await db
    .update(workouts)
    .set({ ownerGroupId: toGroupId, updatedAt: sql`now()` })
    .where(and(editable(workouts, caller), eq(workouts.id, id)))
    .returning({ id: workouts.id })
  if (moved.length === 0) throw notFound('workout')

  return await get(caller, id)
}

/** Visibility, not editability — you may pin anything you can see. */
export async function setFavourite(caller: Caller, id: string, favourite: boolean): Promise<void> {
  const [found] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(visible(workouts, caller), eq(workouts.id, id)))
    .limit(1)
  if (found === undefined) throw notFound('workout')

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
