import { beforeEach, describe, expect, test } from 'bun:test'
import { ApiError, Exercise, GroupMembership, Workout, WorkoutSummary, page } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

const Page = page(WorkoutSummary)

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

async function anExercise(user: TestUser, name = 'Bench Press'): Promise<string> {
  const res = await user.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({ name, muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }] }),
  })
  return expectContract(Exercise, res.body).id
}

async function aWorkout(user: TestUser, name = 'Push Pull Legs'): Promise<Workout> {
  const res = await user.wire('/workouts', { method: 'POST', body: JSON.stringify({ name }) })
  return expectContract(Workout, res.body)
}

const plan = (exerciseId: string) => ({
  days: [
    {
      name: 'Day 1 — Push',
      entries: [
        {
          exerciseId,
          supersetGroup: 'A',
          restSeconds: 120,
          progression: { kind: 'double', repRange: [8, 12], incrementG: 2500 },
          sets: [
            { targetReps: 10, targetWeightG: 20_000, isWarmup: true },
            { targetReps: 8, targetWeightG: 60_000 },
            { targetReps: 8, targetWeightG: 60_000 },
          ],
        },
        { exerciseId, supersetGroup: 'A', sets: [{ targetReps: 12, targetWeightG: 30_000 }] },
      ],
    },
    { name: 'Day 2 — Pull', entries: [{ exerciseId, sets: [{ targetReps: 5 }] }] },
  ],
})

describe('creating and listing', () => {
  test('a new workout starts empty, in the caller’s personal group', async () => {
    const workout = await aWorkout(alice)
    expect(workout.ownerGroupId).toBe(alice.personalGroupId)
    expect(workout.canEdit).toBe(true)
    expect(workout.days).toEqual([])
  })

  test('renaming keeps the notes — an omitted field is not a cleared one', async () => {
    const created = expectContract(
      Workout,
      (
        await alice.wire('/workouts', {
          method: 'POST',
          body: JSON.stringify({ name: 'Block A', notes: 'Deload every fourth week' }),
        })
      ).body,
    )
    const renamed = expectContract(
      Workout,
      (
        await alice.wire(`/workouts/${created.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Block B' }),
        })
      ).body,
    )
    expect(renamed.name).toBe('Block B')
    expect(renamed.notes).toBe('Deload every fourth week')
  })

  test('the list returns summaries with a day count, not full plans', async () => {
    const workout = await aWorkout(alice)
    await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify(plan(await anExercise(alice))),
    })

    const listed = expectContract(Page, (await alice.wire('/workouts')).body)
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]?.dayCount).toBe(2)
    // A summary deliberately carries no `days` key.
    expect(listed.items[0]).not.toHaveProperty('days')
  })
})

describe('the plan replace', () => {
  test('stores days, entries and sets in order, with indices assigned by the server', async () => {
    const workout = await aWorkout(alice)
    const exerciseId = await anExercise(alice)

    const saved = expectContract(
      Workout,
      (
        await alice.wire(`/workouts/${workout.id}/plan`, {
          method: 'PUT',
          body: JSON.stringify(plan(exerciseId)),
        })
      ).body,
    )

    expect(saved.days.map((d) => d.index)).toEqual([0, 1])
    expect(saved.days.map((d) => d.name)).toEqual(['Day 1 — Push', 'Day 2 — Pull'])

    const day1 = saved.days[0]
    expect(day1?.entries.map((e) => e.index)).toEqual([0, 1])
    expect(day1?.entries[0]?.supersetGroup).toBe('A')
    expect(day1?.entries[0]?.restSeconds).toBe(120)
    expect(day1?.entries[0]?.progression).toEqual({
      kind: 'double',
      repRange: [8, 12],
      incrementG: 2500,
    })
    expect(day1?.entries[0]?.sets.map((s) => s.isWarmup)).toEqual([true, false, false])
    expect(day1?.entries[0]?.sets.map((s) => s.index)).toEqual([0, 1, 2])
  })

  test('replaces wholesale — the previous plan is gone, not merged', async () => {
    const workout = await aWorkout(alice)
    const exerciseId = await anExercise(alice)
    await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify(plan(exerciseId)),
    })

    const replaced = expectContract(
      Workout,
      (
        await alice.wire(`/workouts/${workout.id}/plan`, {
          method: 'PUT',
          body: JSON.stringify({
            days: [{ name: 'Only Day', entries: [{ exerciseId, sets: [{ targetReps: 3 }] }] }],
          }),
        })
      ).body,
    )
    expect(replaced.days).toHaveLength(1)
    expect(replaced.days[0]?.name).toBe('Only Day')
  })

  test('the whole replace is atomic — a bad entry leaves the old plan intact', async () => {
    const workout = await aWorkout(alice)
    const exerciseId = await anExercise(alice)
    await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify(plan(exerciseId)),
    })

    // The second day references an exercise that does not exist.
    const rejected = await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [
          { name: 'Fine', entries: [{ exerciseId, sets: [{ targetReps: 5 }] }] },
          {
            name: 'Broken',
            entries: [{ exerciseId: crypto.randomUUID(), sets: [{ targetReps: 5 }] }],
          },
        ],
      }),
    })
    expect(rejected.status).toBe(404)

    const after = expectContract(Workout, (await alice.wire(`/workouts/${workout.id}`)).body)
    expect(after.days).toHaveLength(2)
    expect(after.days[0]?.name).toBe('Day 1 — Push')
  })

  /** Otherwise a plan could reference a hidden exercise and leak its name back out. */
  test('cannot reference an exercise the caller cannot see', async () => {
    const secret = await anExercise(bob, 'Bob’s Secret Lift')
    const workout = await aWorkout(alice)

    const res = await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [{ name: 'Day', entries: [{ exerciseId: secret, sets: [{ targetReps: 5 }] }] }],
      }),
    })
    expect(res.status).toBe(404)
    expectContract(ApiError, res.body)
  })

  test('rejects a plan whose entry is all warm-ups', async () => {
    const workout = await aWorkout(alice)
    const exerciseId = await anExercise(alice)
    const res = await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [
          {
            name: 'Day',
            entries: [{ exerciseId, sets: [{ targetReps: 10, isWarmup: true }] }],
          },
        ],
      }),
    })
    expect(res.status).toBe(422)
  })

  test('rejects a client-supplied index — order is array position', async () => {
    const workout = await aWorkout(alice)
    const exerciseId = await anExercise(alice)
    const res = await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [{ name: 'Day', index: 0, entries: [{ exerciseId, sets: [{ targetReps: 5 }] }] }],
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('access control', () => {
  test("one user cannot see, edit or plan another's workout", async () => {
    const mine = await aWorkout(alice, 'Private Programme')

    expect((await bob.wire(`/workouts/${mine.id}`)).status).toBe(404)
    expect(
      (
        await bob.wire(`/workouts/${mine.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await bob.wire(`/workouts/${mine.id}/plan`, {
          method: 'PUT',
          body: JSON.stringify({ days: [] }),
        })
      ).status,
    ).toBe(422)
    expect((await bob.wire(`/workouts/${mine.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  test('hidden and nonexistent are indistinguishable', async () => {
    const mine = await aWorkout(alice)
    const hidden = await bob.wire(`/workouts/${mine.id}`)
    const missing = await bob.wire(`/workouts/${crypto.randomUUID()}`)
    expect(hidden.status).toBe(missing.status)
    expect(hidden.body).toEqual(missing.body)
  })

  test('every route requires authentication', async () => {
    const id = crypto.randomUUID()
    for (const [path, init] of [
      ['/workouts', {}],
      ['/workouts', { method: 'POST', body: '{}' }],
      [`/workouts/${id}`, {}],
      [`/workouts/${id}/plan`, { method: 'PUT', body: '{}' }],
      [`/workouts/${id}/progression`, {}],
    ] as const) {
      expect((await h.wire(path, init)).status).toBe(401)
    }
  })
})

describe('duplicate and transfer', () => {
  test('duplicating deep-copies the whole plan into an editable group', async () => {
    const squad = expectContract(
      GroupMembership,
      (await alice.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Squad' }) }))
        .body,
    )
    const exerciseId = await anExercise(alice)
    const original = await aWorkout(alice)
    await alice.wire(`/workouts/${original.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify(plan(exerciseId)),
    })
    await alice.wire(`/workouts/${original.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })

    // Re-read: `original` was captured before its plan existed.
    const withPlan = expectContract(Workout, (await alice.wire(`/workouts/${original.id}`)).body)
    expect(withPlan.days).toHaveLength(2)

    const copy = expectContract(
      Workout,
      (await alice.wire(`/workouts/${original.id}/duplicate`, { method: 'POST', body: '{}' })).body,
    )

    expect(copy.id).not.toBe(original.id)
    expect(copy.ownerGroupId).toBe(alice.personalGroupId)
    expect(copy.days).toHaveLength(2)
    expect(copy.days[0]?.entries).toHaveLength(2)
    expect(copy.days[0]?.entries[0]?.sets).toHaveLength(3)
    expect(copy.days[0]?.entries[0]?.progression).toEqual({
      kind: 'double',
      repRange: [8, 12],
      incrementG: 2500,
    })
    expect(copy.days[0]?.entries[0]?.sets.map((s) => s.isWarmup)).toEqual([true, false, false])

    // Distinct rows, not shared ones.
    expect(copy.days[0]?.id).toBeDefined()
    expect(copy.days[0]?.id).not.toBe(withPlan.days[0]?.id)
  })

  test('editing a duplicate does not touch the original', async () => {
    const exerciseId = await anExercise(alice)
    const original = await aWorkout(alice)
    await alice.wire(`/workouts/${original.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify(plan(exerciseId)),
    })

    const copy = expectContract(
      Workout,
      (await alice.wire(`/workouts/${original.id}/duplicate`, { method: 'POST', body: '{}' })).body,
    )
    await alice.wire(`/workouts/${copy.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ days: [{ name: 'Changed', entries: [] }] }),
    })

    const after = expectContract(Workout, (await alice.wire(`/workouts/${original.id}`)).body)
    expect(after.days).toHaveLength(2)
    expect(after.days[0]?.name).toBe('Day 1 — Push')
  })

  test('deleting a workout takes its plan with it', async () => {
    const exerciseId = await anExercise(alice)
    const workout = await aWorkout(alice)
    await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify(plan(exerciseId)),
    })

    expect((await alice.wire(`/workouts/${workout.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.wire(`/workouts/${workout.id}`)).status).toBe(404)
    // The exercise itself survives — it was referenced, not owned.
    expect((await alice.wire(`/exercises/${exerciseId}`)).status).toBe(200)
  })
})
