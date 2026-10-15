import { beforeEach, describe, expect, test } from 'bun:test'
import {
  Exercise,
  ExerciseHistory,
  ProgressionSuggestion,
  SetLog,
  Workout,
  WorkoutSession,
  WorkoutSessionSummary,
  kgToG,
  page,
} from '@cedo/contract'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client.ts'
import { workoutSessions } from '../../db/schema.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

const Page = page(WorkoutSessionSummary)

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

/** A workout with one day, one entry, three working sets of 8 at 60kg, and double progression. */
async function aPlannedWorkout(user: TestUser, exerciseId: string): Promise<Workout> {
  const created = expectContract(
    Workout,
    (await user.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'PPL' }) })).body,
  )
  return expectContract(
    Workout,
    (
      await user.wire(`/workouts/${created.id}/plan`, {
        method: 'PUT',
        body: JSON.stringify({
          days: [
            {
              name: 'Push',
              entries: [
                {
                  exerciseId,
                  progression: { kind: 'double', repRange: [8, 12], incrementG: kgToG(2.5) },
                  sets: [
                    { targetReps: 10, targetWeightG: kgToG(20), isWarmup: true },
                    { targetReps: 8, targetWeightG: kgToG(60) },
                    { targetReps: 8, targetWeightG: kgToG(60) },
                    { targetReps: 8, targetWeightG: kgToG(60) },
                  ],
                },
              ],
            },
          ],
        }),
      })
    ).body,
  )
}

const startSession = async (user: TestUser, body: Record<string, unknown> = {}) =>
  await user.wire('/sessions', { method: 'POST', body: JSON.stringify(body) })

describe('starting a session', () => {
  test('ad hoc, with no plan at all', async () => {
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    expect(session.workoutId).toBeNull()
    expect(session.dayId).toBeNull()
    expect(session.endedAt).toBeNull()
    expect(session.logs).toEqual([])
  })

  test('from a workout day', async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    const dayId = workout.days[0]?.id
    if (dayId === undefined) throw new Error('the planned workout has no day')

    const session = expectContract(
      WorkoutSession,
      (await startSession(alice, { workoutId: workout.id, dayId })).body,
    )
    expect(session.workoutId).toBe(workout.id)
    expect(session.dayId).toBe(dayId)
  })

  test('rejects a day that does not belong to the workout', async () => {
    const a = await aPlannedWorkout(alice, await anExercise(alice, 'A'))
    const b = await aPlannedWorkout(alice, await anExercise(alice, 'B'))
    const res = await startSession(alice, { workoutId: a.id, dayId: b.days[0]?.id })
    expect(res.status).toBe(404)
  })

  test('rejects a dayId with no workoutId', async () => {
    const res = await startSession(alice, { dayId: crypto.randomUUID() })
    expect(res.status).toBe(422)
  })

  test("rejects another user's workout", async () => {
    const theirs = await aPlannedWorkout(bob, await anExercise(bob, 'Bob Lift'))
    expect((await startSession(alice, { workoutId: theirs.id })).status).toBe(404)
  })
})

describe('logging sets', () => {
  test('records what was actually lifted and returns it', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)

    const log = expectContract(
      SetLog,
      (
        await alice.wire(`/sessions/${session.id}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, setIndex: 0, weightG: kgToG(62.5), reps: 8, rpe: 8 }),
        })
      ).body,
    )
    expect(log.weightG).toBe(kgToG(62.5))
    expect(log.reps).toBe(8)
    expect(log.isWarmup).toBe(false)

    const fetched = expectContract(
      WorkoutSession,
      (await alice.wire(`/sessions/${session.id}`)).body,
    )
    expect(fetched.logs).toHaveLength(1)
  })

  test('a duration exercise logs seconds instead of reps', async () => {
    const plank = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Plank',
            tracking: 'duration',
            muscles: [{ muscle: 'rectus_abdominis', loadPct: 100 }],
          }),
        })
      ).body,
    )
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)

    const log = expectContract(
      SetLog,
      (
        await alice.wire(`/sessions/${session.id}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId: plank.id, setIndex: 0, durationS: 65 }),
        })
      ).body,
    )
    expect(log.durationS).toBe(65)
    expect(log.reps).toBeNull()
  })

  test('cannot log against a finished session', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    await alice.wire(`/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    })

    const res = await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId, setIndex: 0, reps: 5 }),
    })
    expect(res.status).toBe(409)
  })

  /**
   * An entry id is what progression reads, so a log may only claim an entry of the plan the
   * session is FOR. Visibility alone let a set logged in Monday's session for plan A count toward
   * plan B's progression.
   */
  test("cannot log against an entry of a different plan than the session's", async () => {
    const exerciseId = await anExercise(alice)
    const planA = await aPlannedWorkout(alice, exerciseId)
    const planB = await aPlannedWorkout(alice, exerciseId)
    const session = expectContract(
      WorkoutSession,
      (await startSession(alice, { workoutId: planA.id, dayId: planA.days[0]?.id })).body,
    )

    const res = await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({
        exerciseId,
        entryId: planB.days[0]?.entries[0]?.id,
        setIndex: 0,
        reps: 5,
      }),
    })
    expect(res.status).toBe(404)
  })

  test('an ad-hoc session has no plan entries to log against', async () => {
    const exerciseId = await anExercise(alice)
    const plan = await aPlannedWorkout(alice, exerciseId)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)

    const res = await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({
        exerciseId,
        entryId: plan.days[0]?.entries[0]?.id,
        setIndex: 0,
        reps: 5,
      }),
    })
    expect(res.status).toBe(422)
  })

  test('a session cannot end before it started', async () => {
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const before = new Date(Date.parse(session.startedAt) - 60_000).toISOString()
    const res = await alice.wire(`/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ endedAt: before }),
    })
    expect(res.status).toBe(422)
  })

  test('cannot log an exercise the caller cannot see', async () => {
    const secret = await anExercise(bob, 'Bob Secret')
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const res = await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId: secret, setIndex: 0, reps: 5 }),
    })
    expect(res.status).toBe(404)
  })

  test('a log can be removed', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const log = expectContract(
      SetLog,
      (
        await alice.wire(`/sessions/${session.id}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, setIndex: 0, reps: 8 }),
        })
      ).body,
    )

    expect(
      (await alice.wire(`/sessions/${session.id}/logs/${log.id}`, { method: 'DELETE' })).status,
    ).toBe(200)
    expect(
      expectContract(WorkoutSession, (await alice.wire(`/sessions/${session.id}`)).body).logs,
    ).toHaveLength(0)
  })
})

/** Sessions are personal — not `ownable()`, never shared. */
describe('sessions are private', () => {
  test("one user cannot read, amend or log into another's session", async () => {
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const exerciseId = await anExercise(bob, 'Bob Lift')

    expect((await bob.wire(`/sessions/${session.id}`)).status).toBe(404)
    expect(
      (
        await bob.wire(`/sessions/${session.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ notes: 'x' }),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await bob.wire(`/sessions/${session.id}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, setIndex: 0, reps: 5 }),
        })
      ).status,
    ).toBe(404)
  })

  test("another user's sessions never appear in the list", async () => {
    await startSession(alice)
    await startSession(alice)
    expect(expectContract(Page, (await bob.wire('/sessions')).body).items).toHaveLength(0)
    expect(expectContract(Page, (await alice.wire('/sessions')).body).items).toHaveLength(2)
  })
})

describe('the session list', () => {
  test('summarises sets and volume, excluding warm-ups', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)

    for (const [reps, isWarmup] of [
      [10, true],
      [8, false],
      [8, false],
    ] as const) {
      await alice.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, setIndex: 0, weightG: kgToG(60), reps, isWarmup }),
      })
    }

    const listed = expectContract(Page, (await alice.wire('/sessions')).body)
    expect(listed.items[0]?.setCount).toBe(2)
    expect(listed.items[0]?.totalVolumeG).toBe(kgToG(60) * 16)
  })

  test('is newest first', async () => {
    const first = expectContract(WorkoutSession, (await startSession(alice)).body)
    await Bun.sleep(5)
    const second = expectContract(WorkoutSession, (await startSession(alice)).body)

    const listed = expectContract(Page, (await alice.wire('/sessions')).body)
    expect(listed.items.map((s) => s.id)).toEqual([second.id, first.id])
  })

  /**
   * Walks every page with `limit=1`. The four start times share ONE millisecond and differ only in
   * microseconds, which is what a burst of MCP `session_log` calls produces. A cursor that loses the
   * microseconds skips sessions; one that hands Postgres a JS Date fails on page two outright.
   */
  test('pages through every session exactly once, even within one millisecond', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      ids.push(expectContract(WorkoutSession, (await startSession(alice)).body).id)
    }
    const micros = ['.123456', '.123200', '.123999', '.123000']
    for (const [i, id] of ids.entries()) {
      await db
        .update(workoutSessions)
        .set({ startedAt: sql`${`2026-03-01 10:00:00${micros[i]}+00`}::timestamptz` })
        .where(eq(workoutSessions.id, id))
    }

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const query: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
      const res = await alice.wire(`/sessions?limit=1${query}`)
      expect(res.status).toBe(200)
      const listed = expectContract(Page, res.body)
      seen.push(...listed.items.map((s) => s.id))
      cursor = listed.nextCursor
    } while (cursor !== null && seen.length <= ids.length)

    // Newest first: .123999, .123456, .123200, .123000.
    expect(seen).toEqual([ids[2]!, ids[0]!, ids[1]!, ids[3]!])
  })

  test('a tampered cursor starts over instead of failing', async () => {
    await startSession(alice)
    for (const junk of [
      Buffer.from(JSON.stringify(['not-a-number', 'not-a-uuid'])).toString('base64url'),
      Buffer.from(JSON.stringify(['1', 'not-a-uuid'])).toString('base64url'),
      Buffer.from(JSON.stringify([1.5, crypto.randomUUID()])).toString('base64url'),
      'garbage',
    ]) {
      const res = await alice.wire(`/sessions?cursor=${junk}`)
      expect(res.status).toBe(200)
      expect(expectContract(Page, res.body).items).toHaveLength(1)
    }
  })
})

describe('exercise history', () => {
  test('groups the caller’s own logs by session, newest first', async () => {
    const exerciseId = await anExercise(alice)

    for (const reps of [8, 9]) {
      const session = expectContract(WorkoutSession, (await startSession(alice)).body)
      await alice.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, setIndex: 0, weightG: kgToG(60), reps }),
      })
      await Bun.sleep(5)
    }

    const history = expectContract(
      ExerciseHistory,
      (await alice.wire(`/exercises/${exerciseId}/history`)).body,
    )
    expect(history.sessions).toHaveLength(2)
    expect(history.sessions[0]?.sets[0]?.reps).toBe(9)
  })

  test("does not include another user's logs for a shared exercise", async () => {
    const { seedLibrary } = await import('../../db/seed.ts')
    await seedLibrary(h.groupId, h.systemUserId)
    const shared = expectContract(page(Exercise), (await alice.wire('/exercises?limit=1')).body)
      .items[0]
    if (shared === undefined) throw new Error('the library produced no exercise')

    const bobSession = expectContract(WorkoutSession, (await startSession(bob)).body)
    await bob.wire(`/sessions/${bobSession.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId: shared.id, setIndex: 0, reps: 12 }),
    })

    const forAlice = expectContract(
      ExerciseHistory,
      (await alice.wire(`/exercises/${shared.id}/history`)).body,
    )
    expect(forAlice.sessions).toHaveLength(0)
  })
})

/** The loop closes here: prescription → logged reality → the next prescription. */
describe('progression suggestions', () => {
  const Suggestions = z.array(ProgressionSuggestion)

  async function logWholeSession(user: TestUser, workout: Workout, reps: number[]): Promise<void> {
    const entry = workout.days[0]?.entries[0]
    if (entry === undefined) throw new Error('the workout has no entry')

    const session = expectContract(
      WorkoutSession,
      (await startSession(user, { workoutId: workout.id, dayId: workout.days[0]?.id })).body,
    )
    for (const [index, count] of reps.entries()) {
      await user.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId: entry.exerciseId,
          entryId: entry.id,
          setIndex: index,
          weightG: kgToG(60),
          reps: count,
        }),
      })
    }
  }

  test('with no history at all, it holds and says so', async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    const [suggestion] = expectContract(
      Suggestions,
      (await alice.wire(`/workouts/${workout.id}/progression`)).body,
    )

    expect(suggestion?.sessionsConsidered).toBe(0)
    expect(suggestion?.changed).toBe(false)
    expect(suggestion?.current.reps).toBe(8)
    expect(suggestion?.suggested).toEqual(suggestion?.current)
  })

  test('clearing every working set climbs one rep', async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    await logWholeSession(alice, workout, [8, 8, 8])

    const [suggestion] = expectContract(
      Suggestions,
      (await alice.wire(`/workouts/${workout.id}/progression`)).body,
    )
    expect(suggestion?.sessionsConsidered).toBe(1)
    expect(suggestion?.changed).toBe(true)
    expect(suggestion?.suggested.reps).toBe(9)
    expect(suggestion?.suggested.weightG).toBe(kgToG(60))
  })

  test('missing one set holds the target', async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    await logWholeSession(alice, workout, [8, 8, 6])

    const [suggestion] = expectContract(
      Suggestions,
      (await alice.wire(`/workouts/${workout.id}/progression`)).body,
    )
    expect(suggestion?.changed).toBe(false)
    expect(suggestion?.suggested.reps).toBe(8)
  })

  test("uses the caller's own history, never someone else's", async () => {
    const squad = expectContract(
      z.object({ id: z.uuid() }),
      (await alice.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Squad' }) }))
        .body,
    )
    const exerciseId = await anExercise(alice)
    const workout = await aPlannedWorkout(alice, exerciseId)

    // Share both with Bob so he can see them.
    await alice.wire(`/exercises/${exerciseId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    await alice.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'reader' }),
    })

    // Alice trains; Bob does not.
    await logWholeSession(alice, workout, [8, 8, 8])

    const forAlice = expectContract(
      Suggestions,
      (await alice.wire(`/workouts/${workout.id}/progression`)).body,
    )
    const forBob = expectContract(
      Suggestions,
      (await bob.wire(`/workouts/${workout.id}/progression`)).body,
    )

    expect(forAlice[0]?.changed).toBe(true)
    expect(forBob[0]?.sessionsConsidered).toBe(0)
    expect(forBob[0]?.changed).toBe(false)
  })

  test('warm-ups do not count toward the working sets', async () => {
    const exerciseId = await anExercise(alice)
    const workout = await aPlannedWorkout(alice, exerciseId)
    const entry = workout.days[0]?.entries[0]
    if (entry === undefined) throw new Error('no entry')

    const session = expectContract(
      WorkoutSession,
      (await startSession(alice, { workoutId: workout.id, dayId: workout.days[0]?.id })).body,
    )
    // A ramp, then only TWO of the three working sets.
    for (const [index, [reps, weight, isWarmup]] of [
      [10, 20, true],
      [8, 60, false],
      [8, 60, false],
    ].entries()) {
      await alice.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId,
          entryId: entry.id,
          setIndex: index,
          weightG: kgToG(Number(weight)),
          reps: Number(reps),
          isWarmup: Boolean(isWarmup),
        }),
      })
    }

    const [suggestion] = expectContract(
      Suggestions,
      (await alice.wire(`/workouts/${workout.id}/progression`)).body,
    )
    // Three working sets were prescribed; only two were logged.
    expect(suggestion?.changed).toBe(false)
  })
})
