import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { type Transaction } from '../../db/client.ts'
import type { WorkoutPlanInput } from '@cedo/contract'
import { type OwnedRow, editable } from '../../db/ownable.ts'
import { workoutDays, workoutEntries, workoutSets } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { valuesOf } from '../../lib/values.ts'
import { required, setsFor } from './plan-rows.ts'

type DayInput = WorkoutPlanInput['days'][number]
type EntryInput = DayInput['entries'][number]

/**
 * Writes a whole plan over whatever the workout holds now, KEEPING every day and entry whose id is
 * sent back. Runs inside the caller's transaction, after its row lock on the workout — and every
 * statement carries `editable()` besides, so the lock is not all that stands between a mistaken
 * call and another group's plan. See docs/adr/0019-visible-relations.md.
 *
 * Identity is the point. `workout_sessions.day_id` and `set_logs.entry_id` are ON DELETE SET NULL,
 * so the first version — delete everything, insert everything — severed all logged history from
 * the plan on every save: progression restarted from zero sessions after renaming a day, and
 * history lost its day names. Now a kept row is UPDATED in place; only what the plan no longer
 * contains is deleted, and only that history loses its link.
 *
 * The client's ids are a hint, never trusted:
 * - an id that is not a day/entry of THIS workout is treated as absent — a new row with a new id —
 *   so a plan can never take over another workout's rows;
 * - an entry whose exercise changed is a new entry, so progression never reads one exercise's logs
 *   as another's.
 *
 * The statement count is constant in the size of the plan: every level is written in bulk, never one
 * statement per row. `(workout_id, index)` and `(day_id, index)` are unique and not deferrable, so
 * kept rows are first parked at negative indices, where no final position can collide with them.
 */
export async function writePlan(
  tx: Transaction,
  caller: Caller,
  workout: OwnedRow,
  plan: WorkoutPlanInput,
): Promise<void> {
  const workoutId = workout.id
  const { keptDay, keptEntry, existingEntryIds } = await identify(tx, caller, workoutId)
  const keptEntryIds = plan.days.flatMap((d) => d.entries.flatMap((e) => keptEntry(e) ?? []))

  // 1. Entries the plan no longer holds. Their logs keep the history and lose the link.
  if (existingEntryIds.length > 0) {
    await tx
      .delete(workoutEntries)
      .where(
        and(
          editable(workoutEntries, caller),
          inArray(workoutEntries.id, existingEntryIds),
          keptEntryIds.length > 0 ? notInArray(workoutEntries.id, keptEntryIds) : undefined,
        ),
      )
  }

  // 2. Park everything kept at a negative index, clear of every final position.
  await park(tx, caller, workoutId, keptEntryIds)

  // 3. Days: kept ones renamed and moved into place, new ones inserted.
  const dayIds = await placeDays(tx, caller, workout, plan, keptDay)

  // 4. Entries: kept ones moved into their day and position — possibly a different day — and new
  //    ones inserted.
  const entryIds = await placeEntries(tx, caller, workout, plan, dayIds, keptEntry)

  // 5. Days the plan no longer holds. Only now: before step 4, a kept entry could still have been
  //    inside one, and the cascade would have taken it.
  await tx
    .delete(workoutDays)
    .where(
      and(
        editable(workoutDays, caller),
        eq(workoutDays.workoutId, workoutId),
        notInArray(workoutDays.id, dayIds),
      ),
    )

  // 6. Sets carry no identity anything refers to, so they are simply rewritten.
  await writeSets(tx, caller, workout, plan, entryIds, keptEntryIds)
}

/**
 * What this workout holds now, as the two predicates that decide what a plan may keep: a day by
 * id, and an entry by id AND unchanged exercise.
 */
async function identify(tx: Transaction, caller: Caller, workoutId: string) {
  const days = await tx
    .select({ id: workoutDays.id })
    .from(workoutDays)
    .where(and(editable(workoutDays, caller), eq(workoutDays.workoutId, workoutId)))
  const entries = await tx
    .select({ id: workoutEntries.id, exerciseId: workoutEntries.exerciseId })
    .from(workoutEntries)
    .innerJoin(workoutDays, eq(workoutDays.id, workoutEntries.dayId))
    .where(
      and(
        editable(workoutEntries, caller),
        editable(workoutDays, caller),
        eq(workoutDays.workoutId, workoutId),
      ),
    )

  const dayIds = new Set(days.map((d) => d.id))
  const exerciseOf = new Map(entries.map((e) => [e.id, e.exerciseId]))
  return {
    keptDay: (day: DayInput) => (day.id !== undefined && dayIds.has(day.id) ? day.id : undefined),
    keptEntry: (entry: EntryInput) =>
      entry.id !== undefined && exerciseOf.get(entry.id) === entry.exerciseId
        ? entry.id
        : undefined,
    existingEntryIds: [...exerciseOf.keys()],
  }
}

async function park(
  tx: Transaction,
  caller: Caller,
  workoutId: string,
  keptEntryIds: string[],
): Promise<void> {
  await tx
    .update(workoutDays)
    .set({ index: sql`-1 - ${workoutDays.index}` })
    .where(and(editable(workoutDays, caller), eq(workoutDays.workoutId, workoutId)))
  if (keptEntryIds.length > 0) {
    await tx
      .update(workoutEntries)
      .set({ index: sql`-1 - ${workoutEntries.index}` })
      .where(and(editable(workoutEntries, caller), inArray(workoutEntries.id, keptEntryIds)))
  }
}

async function writeSets(
  tx: Transaction,
  caller: Caller,
  workout: OwnedRow,
  plan: WorkoutPlanInput,
  entryIds: readonly (readonly string[])[],
  keptEntryIds: string[],
): Promise<void> {
  if (keptEntryIds.length > 0) {
    await tx
      .delete(workoutSets)
      .where(and(editable(workoutSets, caller), inArray(workoutSets.entryId, keptEntryIds)))
  }
  const values = plan.days.flatMap((day, d) =>
    day.entries.flatMap((entry, e) =>
      setsFor(entry, required(entryIds[d]?.[e], `entry ${d}:${e}`), workout.ownerGroupId),
    ),
  )
  if (values.length > 0) await tx.insert(workoutSets).values(values)
}

/** Returns each day's id by position. */
async function placeDays(
  tx: Transaction,
  caller: Caller,
  workout: OwnedRow,
  plan: WorkoutPlanInput,
  keptDay: (day: DayInput) => string | undefined,
): Promise<string[]> {
  const workoutId = workout.id
  const kept = plan.days.flatMap((day, index) => {
    const id = keptDay(day)
    return id === undefined ? [] : [{ id, index, name: day.name }]
  })
  const ids = Array.from<string | undefined>({ length: plan.days.length })

  const moved =
    kept.length === 0
      ? []
      : await tx.execute<{ id: string; index: number }>(sql`
          update workout_days
             set index = v.index::smallint, name = v.name
            from (values ${valuesOf(kept.map((k) => [k.id, k.index, k.name]))}) as v(id, index, name)
           where workout_days.id = v.id::uuid
             and workout_days.workout_id = ${workoutId}
             and ${editable(workoutDays, caller)}
       returning workout_days.id, workout_days.index`)
  for (const row of moved) ids[row.index] = row.id

  const fresh = plan.days.flatMap((day, index) =>
    ids[index] === undefined
      ? [{ workoutId, ownerGroupId: workout.ownerGroupId, index, name: day.name }]
      : [],
  )
  if (fresh.length > 0) {
    const inserted = await tx
      .insert(workoutDays)
      .values(fresh)
      .returning({ id: workoutDays.id, index: workoutDays.index })
    for (const row of inserted) ids[row.index] = row.id
  }

  return plan.days.map((_, index) => required(ids[index], `day ${index}`))
}

/** Returns each entry's id by `[day][position]`. */
async function placeEntries(
  tx: Transaction,
  caller: Caller,
  workout: OwnedRow,
  plan: WorkoutPlanInput,
  dayIds: readonly string[],
  keptEntry: (entry: EntryInput) => string | undefined,
): Promise<string[][]> {
  const ids = plan.days.map((day) => day.entries.map((entry) => keptEntry(entry)))
  await moveKeptEntries(tx, caller, plan, dayIds, keptEntry)

  const fresh = plan.days.flatMap((day, d) =>
    day.entries.flatMap((entry, index) =>
      ids[d]?.[index] === undefined
        ? [
            {
              dayId: required(dayIds[d], `day ${d}`),
              ownerGroupId: workout.ownerGroupId,
              index,
              exerciseId: entry.exerciseId,
              supersetGroup: entry.supersetGroup,
              restSeconds: entry.restSeconds,
              cue: entry.cue,
              progression: entry.progression,
            },
          ]
        : [],
    ),
  )
  if (fresh.length > 0) {
    const inserted = await tx.insert(workoutEntries).values(fresh).returning({
      id: workoutEntries.id,
      dayId: workoutEntries.dayId,
      index: workoutEntries.index,
    })
    for (const row of inserted) {
      const day = ids[dayIds.indexOf(row.dayId)]
      if (day !== undefined) day[row.index] = row.id
    }
  }

  return ids.map((day, d) => day.map((id, e) => required(id, `entry ${d}:${e}`)))
}

/** Every kept entry, into its final day and position in ONE statement. */
async function moveKeptEntries(
  tx: Transaction,
  caller: Caller,
  plan: WorkoutPlanInput,
  dayIds: readonly string[],
  keptEntry: (entry: EntryInput) => string | undefined,
): Promise<void> {
  const kept = plan.days.flatMap((day, d) =>
    day.entries.flatMap((entry, index) => {
      const id = keptEntry(entry)
      if (id === undefined) return []
      return [
        [
          id,
          required(dayIds[d], `day ${d}`),
          index,
          entry.supersetGroup,
          entry.restSeconds,
          entry.cue,
          JSON.stringify(entry.progression),
        ],
      ]
    }),
  )
  if (kept.length > 0) {
    await tx.execute(sql`
      update workout_entries
         set day_id = v.day_id::uuid,
             index = v.index::smallint,
             superset_group = v.superset_group::char(1),
             rest_seconds = v.rest_seconds::integer,
             cue = v.cue::text,
             progression = v.progression::jsonb
        from (values ${valuesOf(kept)}) as v(id, day_id, index, superset_group, rest_seconds, cue, progression)
       where workout_entries.id = v.id::uuid
         and ${editable(workoutEntries, caller)}`)
  }
}
