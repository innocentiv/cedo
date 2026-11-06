import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { type Database, type Transaction, db } from '../../db/client.ts'
import { progressionSteps } from '../../db/schema.ts'
import { visibleExercises, visibleWorkoutEntries, visibleWorkoutSets } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { planEntries } from '../workout/plan.ts'
import type { LatestStep } from './evaluate.ts'

/**
 * What progression reads (#36 moved it here, for a plan's targets and a session's alike): the
 * entries, their prescribed sets, and the caller's latest step on each.
 */

/**
 * Which of a workout's entries are read: every one (a plan's targets), one day's (a session's), or
 * one (a target set by hand).
 */
export type Within = { readonly dayId: string } | { readonly entryId: string } | null

/**
 * The entries to evaluate — those `within` names — their prescribed sets, and the caller's latest
 * step on each. Null when there is no entry the caller can see.
 */
export async function loadEntries(
  caller: Caller,
  workoutId: string,
  within: Within,
  /** A write's transaction, when one reads: its connection, and what it has written. */
  on: Database | Transaction = db,
) {
  const plan = planEntries(caller, workoutId)
  const exercises = visibleExercises(caller)
  const entries = await on
    .select({
      id: plan.id,
      exerciseId: plan.exerciseId,
      exerciseName: exercises.name,
      tracking: exercises.tracking,
      equipment: exercises.equipment,
      progression: plan.progression,
    })
    .from(plan)
    /**
     * An INNER join onto the visible exercises: without it a target returns the name and
     * prescribed load of an exercise the caller cannot see. Entries whose exercise is hidden simply
     * do not appear — there is nothing useful to advise about a movement you cannot read.
     */
    .innerJoin(exercises, eq(exercises.id, plan.exerciseId))
    .where(
      within === null
        ? undefined
        : 'dayId' in within
          ? eq(plan.dayId, within.dayId)
          : eq(plan.id, within.entryId),
    )
    .orderBy(asc(plan.dayIndex), asc(plan.index))
  if (entries.length === 0) return null

  const entryIds = entries.map((e) => e.id)

  const sets = visibleWorkoutSets(caller)
  const prescribed = await on
    .select()
    .from(sets)
    .where(inArray(sets.entryId, entryIds))
    .orderBy(asc(sets.index))

  return { entries, prescribed, steps: await latestSteps(caller, entryIds, on) }
}

/**
 * The caller's latest step on each entry, and the run behind it (#66) — one query for a whole
 * plan, walking `progression_steps_target_idx`. Only the CALLER's own: steps are personal, so one
 * person's progress never moves another's target on a shared plan.
 *
 * The run is the steps from the latest back to where its target last started: the first step taken
 * against another plan (`cut` — the target restarted from the prescription after it), or the first
 * set by hand (`anchor` — the target started there, and it is in the run). "Another plan" is any
 * difference in what a step was taken against, which `stillCounts` judges more loosely — another
 * working set keeps a target — so the run can come out short, never long.
 */
async function latestSteps(
  caller: Caller,
  entryIds: readonly string[],
  on: Database | Transaction,
): Promise<LatestStep[]> {
  const bounded = withRunEnds(newestFirst(caller, entryIds))
  return await on
    .select({
      entryId: bounded.entryId,
      target: bounded.target,
      held: bounded.held,
      against: bounded.against,
      // Every step before the run's end is a session: the first by hand is the end, or past it.
      sessions:
        sql<number>`coalesce(least(${bounded.cut}, ${bounded.anchor}), ${bounded.total} + 1) - 1`.mapWith(
          Number,
        ),
      byHand: sql<boolean>`${bounded.anchor} is not null and ${bounded.anchor} < coalesce(${bounded.cut}, ${bounded.total} + 1)`,
    })
    .from(bounded)
    .where(sql`${bounded.rank} = 1`)
}

/** The caller's steps on the entries, newest first (`rank` 1 the latest), beside the latest's `against`. */
function newestFirst(caller: Caller, entryIds: readonly string[]) {
  // Through the visible entries (ADR-0019): a target is advice about an entry the caller can see.
  const visible = visibleWorkoutEntries(caller)
  const order = sql`partition by ${progressionSteps.entryId} order by ${progressionSteps.takenAt} desc, ${progressionSteps.id} desc`
  return db
    .select({
      entryId: progressionSteps.entryId,
      kind: progressionSteps.kind,
      target: progressionSteps.target,
      held: progressionSteps.held,
      against: progressionSteps.against,
      rank: sql<number>`row_number() over (${order})`.as('rank'),
      latest: sql`first_value(${progressionSteps.against}) over (${order})`.as('latest_against'),
    })
    .from(progressionSteps)
    .innerJoin(visible, eq(visible.id, progressionSteps.entryId))
    .where(
      and(
        eq(progressionSteps.userId, caller.userId),
        inArray(progressionSteps.entryId, [...entryIds]),
      ),
    )
    .as('ranked_steps')
}

/**
 * Each step beside where the run behind its entry's latest ends — `cut` and `anchor`, the first of
 * each walking back, null if none — and how many steps the entry has.
 */
function withRunEnds(ranked: ReturnType<typeof newestFirst>) {
  const entry = sql`partition by ${ranked.entryId}`
  return db
    .select({
      entryId: ranked.entryId,
      target: ranked.target,
      held: ranked.held,
      against: ranked.against,
      rank: ranked.rank,
      cut: sql`min(${ranked.rank}) filter (where ${ranked.against} is distinct from ${ranked.latest}) over (${entry})`.as(
        'cut',
      ),
      anchor: sql`min(${ranked.rank}) filter (where ${ranked.kind} = 'by_hand') over (${entry})`.as(
        'anchor',
      ),
      total: sql`count(*) over (${entry})`.as('total'),
    })
    .from(ranked)
    .as('bounded_steps')
}
