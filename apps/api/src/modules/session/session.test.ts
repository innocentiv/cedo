import { beforeEach, describe, expect, test } from 'bun:test'
import {
  ApiError,
  Exercise,
  ExerciseHistory,
  GroupMembership,
  MAX_SET_INDEX,
  ProgressionSuggestion,
  SessionLogInput,
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
import { seedLibrary } from '../../db/seed.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import * as SessionService from './service.ts'

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
          body: JSON.stringify({ exerciseId, weightG: kgToG(62.5), reps: 8, rpe: 8 }),
        })
      ).body,
    )
    expect(log.weightG).toBe(kgToG(62.5))
    expect(log.reps).toBe(8)
    expect(log.isWarmup).toBe(false)
    // The log names what it was logged against, so a screen never rebuilds that from a plan.
    expect(log.exercise).toEqual({ name: 'Bench Press', tracking: 'weight_reps' })

    const fetched = expectContract(
      WorkoutSession,
      (await alice.wire(`/sessions/${session.id}`)).body,
    )
    expect(fetched.logs).toHaveLength(1)
    expect(fetched.logs[0]?.exercise).toEqual({ name: 'Bench Press', tracking: 'weight_reps' })
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
          body: JSON.stringify({ exerciseId: plank.id, durationS: 65 }),
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
      body: JSON.stringify({ exerciseId, reps: 5 }),
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
        reps: 5,
      }),
    })
    expect(res.status).toBe(422)
  })

  /**
   * Clamped, not refused: the app finishes with the phone's clock, the start is the database's,
   * and a phone running behind must still be able to finish a short session.
   */
  test('a session cannot end before it started — an earlier end is clamped to the start', async () => {
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const before = new Date(Date.parse(session.startedAt) - 60_000).toISOString()
    const res = await alice.wire(`/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ endedAt: before }),
    })
    expect(res.status).toBe(200)
    const finished = expectContract(WorkoutSession, res.body)
    expect(finished.endedAt).toBe(finished.startedAt)
  })

  test('cannot log an exercise the caller cannot see', async () => {
    const secret = await anExercise(bob, 'Bob Secret')
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const res = await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId: secret, reps: 5 }),
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
          body: JSON.stringify({ exerciseId, reps: 8 }),
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

/** `session_log` over MCP: a whole, finished session in one write. */
describe('logging a whole session at once', () => {
  /**
   * One INSERT shares one `now()`, and a session's logs read back by `logged_at`, then `set_index`
   * — so equal timestamps interleaved the exercises: squat 1, bench 1, squat 2, bench 2.
   */
  test('reads its sets back in the order they were sent, and ends after the last', async () => {
    const squat = await anExercise(alice, 'Squat')
    const bench = await anExercise(alice, 'Bench Press')
    const logged = await SessionService.logWhole(
      alice.caller,
      SessionLogInput.parse({
        sets: [
          { exerciseId: squat, reps: 5 },
          { exerciseId: squat, reps: 5 },
          { exerciseId: bench, reps: 8 },
          { exerciseId: bench, reps: 8 },
        ],
      }),
    )

    const read = expectContract(WorkoutSession, (await alice.wire(`/sessions/${logged.id}`)).body)
    expect(read.logs.map((l) => [l.exerciseId, l.setIndex])).toEqual([
      [squat, 0],
      [squat, 1],
      [bench, 0],
      [bench, 1],
    ])
    const last = read.logs.at(-1)?.loggedAt
    expect(Date.parse(read.endedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(last ?? ''))
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
          body: JSON.stringify({ exerciseId, reps: 5 }),
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
  test('summarises sets and weight lifted, excluding warm-ups', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)

    for (const [reps, isWarmup] of [
      [10, true],
      [8, false],
      [8, false],
    ] as const) {
      await alice.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps, isWarmup }),
      })
    }

    const listed = expectContract(Page, (await alice.wire('/sessions')).body)
    expect(listed.items[0]?.setCount).toBe(2)
    expect(listed.items[0]?.liftedG).toBe(kgToG(60) * 16)
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
      Buffer.from(JSON.stringify(['9999999999999999999', crypto.randomUUID()])).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify(['9223372036854775807', crypto.randomUUID()])).toString(
        'base64url',
      ),
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
        body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps }),
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
    await seedLibrary(h.groupId, h.systemUserId)
    const shared = expectContract(page(Exercise), (await alice.wire('/exercises?limit=1')).body)
      .items[0]
    if (shared === undefined) throw new Error('the library produced no exercise')

    const bobSession = expectContract(WorkoutSession, (await startSession(bob)).body)
    await bob.wire(`/sessions/${bobSession.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId: shared.id, reps: 12 }),
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
    for (const count of reps) {
      await user.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId: entry.exerciseId,
          entryId: entry.id,
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
    for (const [reps, weight, isWarmup] of [
      [10, 20, true],
      [8, 60, false],
      [8, 60, false],
    ]) {
      await alice.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId,
          entryId: entry.id,
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

/**
 * The server numbers every set, within its series — one plan entry, or one exercise logged with no
 * entry — the same way for the app and for an AI. See `nextSetIndex` and GLOSSARY.md, "Series".
 */
describe('numbering sets', () => {
  const logTo = async (sessionId: string, body: Record<string, unknown>) =>
    expectContract(
      SetLog,
      (
        await alice.wire(`/sessions/${sessionId}/logs`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
      ).body,
    )

  test('each set takes the next number in its series, and an undone number is not reused', async () => {
    const exerciseId = await anExercise(alice)
    const { id } = expectContract(WorkoutSession, (await startSession(alice)).body)
    const first = await logTo(id, { exerciseId, reps: 5 })
    const second = await logTo(id, { exerciseId, reps: 5 })
    const third = await logTo(id, { exerciseId, reps: 5 })
    expect([first, second, third].map((l) => l.setIndex)).toEqual([0, 1, 2])

    await alice.wire(`/sessions/${id}/logs/${second.id}`, { method: 'DELETE' })
    expect((await logTo(id, { exerciseId, reps: 5 })).setIndex).toBe(3)
  })

  /**
   * Regression: the screen numbered an ad-hoc set among EVERY log of its exercise, planned ones
   * included, so bench logged without a plan after two planned sets began at "set 3".
   */
  test('a set logged without an entry starts its own series, apart from the planned ones', async () => {
    const exerciseId = await anExercise(alice)
    const workout = await aPlannedWorkout(alice, exerciseId)
    const day = workout.days[0]
    const entry = day?.entries[0]
    if (day === undefined || entry === undefined) throw new Error('the workout has no entry')
    const { id } = expectContract(
      WorkoutSession,
      (await startSession(alice, { workoutId: workout.id, dayId: day.id })).body,
    )
    await logTo(id, { exerciseId, entryId: entry.id, reps: 8 })
    await logTo(id, { exerciseId, entryId: entry.id, reps: 8 })

    expect((await logTo(id, { exerciseId, reps: 8 })).setIndex).toBe(0)
    expect((await logTo(id, { exerciseId, entryId: entry.id, reps: 8 })).setIndex).toBe(2)
  })

  /** Numbered under the session's lock: two devices logging at once cannot take one number. */
  test('sets logged at the same moment take different numbers', async () => {
    const exerciseId = await anExercise(alice)
    const { id } = expectContract(WorkoutSession, (await startSession(alice)).body)
    const logged = await Promise.all(
      Array.from({ length: 6 }, async () => await logTo(id, { exerciseId, reps: 5 })),
    )
    expect(logged.map((l) => l.setIndex).toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
  })

  test('a whole session is numbered per series in the order sent, warm-ups included', async () => {
    const squat = await anExercise(alice, 'Squat')
    const bench = await anExercise(alice, 'Bench Press')
    const logged = await SessionService.logWhole(
      alice.caller,
      SessionLogInput.parse({
        sets: [
          { exerciseId: squat, reps: 10, isWarmup: true },
          { exerciseId: bench, reps: 8 },
          { exerciseId: squat, reps: 5 },
          { exerciseId: squat, reps: 5 },
        ],
      }),
    )
    expect(logged.logs.map((l) => [l.exerciseId, l.setIndex])).toEqual([
      [squat, 0],
      [bench, 0],
      [squat, 1],
      [squat, 2],
    ])
  })

  /** The number is not the caller's to give — and a caller still giving one is told, not ignored. */
  test('a set that still names its own number is refused', async () => {
    const exerciseId = await anExercise(alice)
    const { id } = expectContract(WorkoutSession, (await startSession(alice)).body)
    const res = await alice.wire(`/sessions/${id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId, setIndex: 7, reps: 5 }),
    })
    expect(res.status).toBe(422)
  })
})

describe('a plan edit after sets were logged', () => {
  /**
   * Removing an entry from a plan keeps its logs, detached (`entry_id` set null), in their
   * exercise's entry-free series. Regression: a unique constraint on (session, exercise, entry,
   * number) made this plan save a 500 — the detached sets collided with the ad-hoc ones.
   */
  test('removing an entry whose sets share numbers with ad-hoc sets of its exercise still saves', async () => {
    const exerciseId = await anExercise(alice)
    const workout = await aPlannedWorkout(alice, exerciseId)
    const day = workout.days[0]
    const entry = day?.entries[0]
    if (day === undefined || entry === undefined) throw new Error('the workout has no entry')
    const { id } = expectContract(
      WorkoutSession,
      (await startSession(alice, { workoutId: workout.id, dayId: day.id })).body,
    )
    for (const body of [
      { exerciseId, entryId: entry.id, reps: 8 },
      { exerciseId, reps: 8 },
    ]) {
      await alice.wire(`/sessions/${id}/logs`, { method: 'POST', body: JSON.stringify(body) })
    }

    const saved = await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ days: [{ id: day.id, name: day.name, entries: [] }] }),
    })
    expect(saved.status).toBe(200)

    // Both sets are now the exercise's entry-free series; the next one numbers after them.
    const next = expectContract(
      SetLog,
      (
        await alice.wire(`/sessions/${id}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, reps: 8 }),
        })
      ).body,
    )
    expect(next.setIndex).toBe(1)
  })
})

describe('a session whose plan is out of reach', () => {
  /**
   * The plan behind a session can become unreachable mid-workout — the lifter is removed from the
   * group it lives in. Their sets against it count as logged with no entry, so the session goes on
   * like one without a plan: the squat logged against the plan is set 1, and the next is set 2.
   */
  test('goes on numbering its sets after the ones logged against the plan', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const squat = expectContract(
      z.object({ items: z.array(Exercise) }),
      (await bob.wire('/exercises?q=Back%20Squat&limit=1')).body,
    ).items[0]
    if (squat === undefined) throw new Error('the library has no Back Squat')
    const squad = expectContract(
      GroupMembership,
      (await alice.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Squad' }) }))
        .body,
    )
    const joined = await alice.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'reader' }),
    })
    expect(joined.status).toBe(200)
    const workout = await aPlannedWorkout(alice, squat.id)
    const moved = await alice.wire(`/workouts/${workout.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: squad.id }),
    })
    expect(moved.status).toBe(200)
    const day = workout.days[0]
    const entry = day?.entries[0]
    if (day === undefined || entry === undefined) throw new Error('the workout has no entry')

    const { id } = expectContract(
      WorkoutSession,
      (await startSession(bob, { workoutId: workout.id, dayId: day.id })).body,
    )
    const planned = await bob.wire(`/sessions/${id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId: squat.id, entryId: entry.id, reps: 5 }),
    })
    expect(planned.status).toBe(200)
    const removed = await alice.wire(`/groups/${squad.id}/members/${bob.userId}`, {
      method: 'DELETE',
    })
    expect(removed.status).toBe(200)

    // The set logged against the lost plan now reads as logged with none — the series it counts in.
    const read = expectContract(WorkoutSession, (await bob.wire(`/sessions/${id}`)).body)
    expect(read.logs.map((l) => [l.setIndex, l.entryId])).toEqual([[0, null]])

    const next = expectContract(
      SetLog,
      (
        await bob.wire(`/sessions/${id}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId: squat.id, reps: 5 }),
        })
      ).body,
    )
    expect(next.setIndex).toBe(1)
  })
})

/** A series is numbered to `MAX_SET_INDEX`; one past it is refused, not stored past the contract. */
test('a set past the most a series holds is refused', async () => {
  const exerciseId = await anExercise(alice)
  const { id } = expectContract(WorkoutSession, (await startSession(alice)).body)
  await db.insert(setLogs).values(
    Array.from({ length: MAX_SET_INDEX + 1 }, (_, setIndex) => ({
      sessionId: id,
      exerciseId,
      setIndex,
      reps: 5,
    })),
  )
  const res = await alice.wire(`/sessions/${id}/logs`, {
    method: 'POST',
    body: JSON.stringify({ exerciseId, reps: 5 }),
  })
  // Refused by the numbering, before the insert — not stored, then failing the response contract,
  // which is ALSO a 422 and is what happened without the check: the message tells them apart.
  expect(res.status).toBe(422)
  expect(expectContract(ApiError, res.body).error.message).toBe('A series holds at most 1000 sets')
  const read = expectContract(WorkoutSession, (await alice.wire(`/sessions/${id}`)).body)
  expect(read.logs).toHaveLength(MAX_SET_INDEX + 1)
})
