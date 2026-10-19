import { beforeEach, describe, expect, test } from 'bun:test'
import {
  Exercise,
  ProgressionSuggestion,
  Workout,
  WorkoutSession,
  WorkoutSessionSummary,
  kgToG,
  page,
  planInputFrom,
} from '@cedo/contract'
import { z } from 'zod'
import { expectContract } from '../../test/contract.ts'
import { type TestUser, makeApi } from '../../test/harness.ts'

/**
 * Saving a plan keeps the identity of every day and entry it sends back.
 *
 * Logged history hangs off those ids — `set_logs.entry_id` feeds progression, and
 * `workout_sessions.day_id` names the day in history — through ON DELETE SET NULL. A save that
 * deleted and re-inserted the whole plan severed all of it, so renaming a day reset every
 * progression to zero sessions considered. See docs/06-api.md.
 */

let alice: TestUser

beforeEach(async () => {
  alice = await (await makeApi()).as('alice')
})

async function anExercise(user: TestUser, name: string): Promise<string> {
  const res = await user.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({ name, muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }] }),
  })
  return expectContract(Exercise, res.body).id
}

const entry = (exerciseId: string) => ({
  exerciseId,
  progression: { kind: 'double', repRange: [8, 12], incrementG: kgToG(2.5) },
  sets: [1, 2, 3].map(() => ({ targetReps: 8, targetWeightG: kgToG(60) })),
})

async function save(user: TestUser, workoutId: string, plan: unknown): Promise<Workout> {
  const res = await user.wire(`/workouts/${workoutId}/plan`, {
    method: 'PUT',
    body: JSON.stringify(plan),
  })
  return expectContract(Workout, res.body)
}

/** Two days; the first has a bench and a fly. */
async function aPlan(user: TestUser): Promise<Workout> {
  const bench = await anExercise(user, 'Bench Press')
  const fly = await anExercise(user, 'Cable Fly')
  const created = expectContract(
    Workout,
    (await user.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'PPL' }) })).body,
  )
  return await save(user, created.id, {
    days: [
      { name: 'Push', entries: [entry(bench), entry(fly)] },
      { name: 'Pull', entries: [entry(bench)] },
    ],
  })
}

/** One completed session of the first day, every working set at 8 reps. */
async function logFirstDay(user: TestUser, workout: Workout): Promise<void> {
  const day = workout.days[0]
  const bench = day?.entries[0]
  if (day === undefined || bench === undefined) throw new Error('the plan has no first entry')
  const session = expectContract(
    WorkoutSession,
    (
      await user.wire('/sessions', {
        method: 'POST',
        body: JSON.stringify({ workoutId: workout.id, dayId: day.id }),
      })
    ).body,
  )
  for (const reps of [8, 8, 8]) {
    await user.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({
        exerciseId: bench.exerciseId,
        entryId: bench.id,
        weightG: kgToG(60),
        reps,
      }),
    })
  }
}

/** How many logged sessions progression sees for one entry of the plan. */
async function sessionsSeen(
  user: TestUser,
  workoutId: string,
  entryId: string | undefined,
): Promise<number | undefined> {
  const suggestions = expectContract(
    z.array(ProgressionSuggestion),
    (await user.wire(`/workouts/${workoutId}/progression`)).body,
  )
  return suggestions.find((s) => s.entryId === entryId)?.sessionsConsidered
}

describe('saving a plan keeps the identity of what it sends back', () => {
  test('renaming a day and retargeting its sets keeps the logged history attached', async () => {
    const plan = await aPlan(alice)
    await logFirstDay(alice, plan)
    expect(await sessionsSeen(alice, plan.id, plan.days[0]?.entries[0]?.id)).toBe(1)

    const edited = planInputFrom(plan)
    const push = edited.days[0]
    if (push === undefined) throw new Error('no first day')
    push.name = 'Chest'
    for (const set of push.entries[0]?.sets ?? []) set.targetWeightG = kgToG(62.5)

    const saved = await save(alice, plan.id, edited)
    expect(saved.days[0]?.id).toBe(plan.days[0]?.id)
    expect(saved.days[0]?.entries[0]?.id).toBe(plan.days[0]?.entries[0]?.id)
    expect(saved.days[0]?.entries[0]?.sets[0]?.target.weightG).toBe(kgToG(62.5))

    // Progression still sees the session, and history still names the day.
    expect(await sessionsSeen(alice, plan.id, saved.days[0]?.entries[0]?.id)).toBe(1)
    const sessions = expectContract(
      page(WorkoutSessionSummary),
      (await alice.wire('/sessions')).body,
    )
    expect(sessions.items[0]?.dayName).toBe('Chest')
  })

  test('reordering days and entries moves them, identity and all', async () => {
    const plan = await aPlan(alice)
    const edited = planInputFrom(plan)
    const [push, pull] = edited.days
    if (push === undefined || pull === undefined) throw new Error('expected two days')
    push.entries.reverse()

    const saved = await save(alice, plan.id, { days: [pull, push] })
    expect(saved.days.map((d) => d.id)).toEqual([plan.days[1]!.id, plan.days[0]!.id])
    expect(saved.days[1]?.entries.map((e) => e.id)).toEqual(
      plan.days[0]?.entries.map((e) => e.id).toReversed(),
    )
    expect(saved.days.map((d) => d.index)).toEqual([0, 1])
    expect(saved.days[1]?.entries.map((e) => e.index)).toEqual([0, 1])
  })

  test('an entry can move to another day and keep its history', async () => {
    const plan = await aPlan(alice)
    await logFirstDay(alice, plan)

    const edited = planInputFrom(plan)
    const [push, pull] = edited.days
    const bench = push?.entries.shift()
    if (pull === undefined || bench === undefined) throw new Error('expected a bench on day one')
    pull.entries.unshift(bench)

    const saved = await save(alice, plan.id, edited)
    expect(saved.days[1]?.entries[0]?.id).toBe(plan.days[0]?.entries[0]?.id)
    expect(await sessionsSeen(alice, plan.id, saved.days[1]?.entries[0]?.id)).toBe(1)
  })

  test('an entry whose exercise changed is a new entry — its history is not inherited', async () => {
    const plan = await aPlan(alice)
    await logFirstDay(alice, plan)
    const dips = await anExercise(alice, 'Dips')

    const edited = planInputFrom(plan)
    const bench = edited.days[0]?.entries[0]
    if (bench === undefined) throw new Error('no bench')
    bench.exerciseId = dips

    const saved = await save(alice, plan.id, edited)
    expect(saved.days[0]?.entries[0]?.id).not.toBe(plan.days[0]?.entries[0]?.id)
    expect(await sessionsSeen(alice, plan.id, saved.days[0]?.entries[0]?.id)).toBe(0)
  })

  test('removing an entry keeps the logs, just no longer linked to a plan entry', async () => {
    const plan = await aPlan(alice)
    await logFirstDay(alice, plan)

    const edited = planInputFrom(plan)
    edited.days[0]?.entries.shift()
    const saved = await save(alice, plan.id, edited)
    expect(saved.days[0]?.entries).toHaveLength(1)

    const exerciseId = plan.days[0]?.entries[0]?.exerciseId
    const history = (await alice.wire(`/exercises/${exerciseId}/history`)).body
    expect(JSON.stringify(history)).toContain('"reps":8')
  })

  test('an id that is not part of this workout is a new row, never a takeover', async () => {
    const mine = await aPlan(alice)
    const other = await aPlan(alice)

    const hijack = planInputFrom(mine)
    const day = hijack.days[0]
    if (day === undefined) throw new Error('no day')
    day.id = other.days[0]?.id
    const saved = await save(alice, mine.id, hijack)

    expect(saved.days[0]?.id).not.toBe(other.days[0]?.id)
    const untouched = expectContract(Workout, (await alice.wire(`/workouts/${other.id}`)).body)
    expect(untouched.days.map((d) => d.id)).toEqual(other.days.map((d) => d.id))
  })

  test('the same id twice in one plan is rejected', async () => {
    const plan = await aPlan(alice)
    const edited = planInputFrom(plan)
    const push = edited.days[0]
    if (push === undefined) throw new Error('no day')
    const res = await alice.wire(`/workouts/${plan.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ days: [push, push] }),
    })
    expect(res.status).toBe(422)
  })
})
