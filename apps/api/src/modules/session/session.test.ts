import { beforeEach, describe, expect, test } from 'bun:test'
import {
  ApiError,
  EntryTarget,
  Exercise,
  ExerciseHistory,
  GroupMembership,
  IDEMPOTENCY_KEY_HEADER,
  LogSetInput,
  MAX_SET_INDEX,
  ProgressionSuggestion,
  SessionDetail,
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
import { logSet } from './set-writes.ts'
import { logWhole } from './log-whole.ts'

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

/** Finishes a session — so the next can start: one is in progress at a time. */
const finishSession = async (user: TestUser, id: string): Promise<void> => {
  const res = await user.wire(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ endedAt: new Date().toISOString() }),
  })
  expect(res.status).toBe(200)
}

/** A session started and finished — one of several a test needs. */
const aFinishedSession = async (user: TestUser): Promise<WorkoutSession> => {
  const session = expectContract(WorkoutSession, (await startSession(user)).body)
  await finishSession(user, session.id)
  return session
}

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
          body: JSON.stringify({ exerciseId, weightG: kgToG(62.5), reps: 8, reserve: 2 }),
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

/**
 * A set sent on a weak signal may reach the server and lose its answer; the phone cannot tell, so
 * it sends it again with the same `Idempotency-Key`. Stored once, whatever happened since.
 */
describe('a retried log, by its idempotency key', () => {
  const logOnce = async (user: TestUser, sessionId: string, exerciseId: string, key?: string) =>
    await user.wire(`/sessions/${sessionId}/logs`, {
      method: 'POST',
      headers: key === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: key },
      body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps: 8 }),
    })
  const storedLogs = async (sessionId: string) =>
    await db.select({ id: setLogs.id }).from(setLogs).where(eq(setLogs.sessionId, sessionId))

  test('the same key twice is one set, and both answers are it', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const key = crypto.randomUUID()

    const first = expectContract(SetLog, (await logOnce(alice, session.id, exerciseId, key)).body)
    const again = expectContract(SetLog, (await logOnce(alice, session.id, exerciseId, key)).body)
    expect(again).toEqual(first)
    expect(await storedLogs(session.id)).toHaveLength(1)
  })

  test('two keys, or none, are two sets — as two taps are', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    await logOnce(alice, session.id, exerciseId, crypto.randomUUID())
    await logOnce(alice, session.id, exerciseId, crypto.randomUUID())
    await logOnce(alice, session.id, exerciseId)
    await logOnce(alice, session.id, exerciseId)
    expect(await storedLogs(session.id)).toHaveLength(4)
  })

  /** The repeat is the SAME request: its answer cannot change because the session ended since. */
  test('a repeat after the session was finished is still the stored set, not a refusal', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const key = crypto.randomUUID()
    const first = expectContract(SetLog, (await logOnce(alice, session.id, exerciseId, key)).body)
    await finishSession(alice, session.id)

    const again = await logOnce(alice, session.id, exerciseId, key)
    expect(again.status).toBe(200)
    expect(expectContract(SetLog, again.body).id).toBe(first.id)
  })

  test('a key is the session’s own: the same key in another session logs there', async () => {
    const exerciseId = await anExercise(alice)
    const key = crypto.randomUUID()
    const one = expectContract(WorkoutSession, (await startSession(alice)).body)
    await logOnce(alice, one.id, exerciseId, key)
    await finishSession(alice, one.id)

    const two = expectContract(WorkoutSession, (await startSession(alice)).body)
    expect((await logOnce(alice, two.id, exerciseId, key)).status).toBe(200)
    expect(await storedLogs(one.id)).toHaveLength(1)
    expect(await storedLogs(two.id)).toHaveLength(1)
  })

  /**
   * Thirty sends of one key at once — a retry storm — store one set: the check runs again under
   * the session's lock. Driven through the service, as the in-process harness may never race.
   */
  test('the same key sent many times at once is still one set', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const key = crypto.randomUUID()
    const input = LogSetInput.parse({ exerciseId, weightG: kgToG(60), reps: 8 })
    const answers = await Promise.all(
      Array.from({ length: 30 }, async () => await logSet(alice.caller, session.id, input, key)),
    )
    expect(new Set(answers.map((a) => a.id)).size).toBe(1)
    expect(await storedLogs(session.id)).toHaveLength(1)
  })

  test('a key that is not a UUID is refused', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    expect((await logOnce(alice, session.id, exerciseId, 'again')).status).toBe(422)
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
    const logged = await logWhole(
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
    await aFinishedSession(alice)
    await aFinishedSession(alice)
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
    const first = await aFinishedSession(alice)
    await Bun.sleep(5)
    const second = await aFinishedSession(alice)

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
      ids.push((await aFinishedSession(alice)).id)
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
      await finishSession(alice, session.id)
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

  /** The badge on the exercise screen: the same judgement `training_review` makes. */
  describe('says whether it has stalled', () => {
    const sessionsOf = async (exerciseId: string, sets: { weightG: number; reps: number }[][]) => {
      for (const session of sets) {
        const started = expectContract(WorkoutSession, (await startSession(alice)).body)
        for (const set of session) {
          await alice.wire(`/sessions/${started.id}/logs`, {
            method: 'POST',
            body: JSON.stringify({ exerciseId, ...set }),
          })
        }
        await finishSession(alice, started.id)
        await Bun.sleep(5)
      }
      return expectContract(
        ExerciseHistory,
        (await alice.wire(`/exercises/${exerciseId}/history`)).body,
      )
    }
    const top = { weightG: kgToG(60), reps: 5 }

    test('three sessions at one top set, however the back-off sets went', async () => {
      const history = await sessionsOf(await anExercise(alice), [
        [top, { weightG: kgToG(50), reps: 8 }],
        [top, { weightG: kgToG(50), reps: 6 }],
        [top],
      ])
      expect(history.stalled).toEqual({
        sessions: 3,
        effort: { weightG: kgToG(60), reps: 5, durationS: null, distanceMm: null },
      })
    })

    test('not while the top set still moves, nor before three sessions', async () => {
      const moving = await sessionsOf(await anExercise(alice, 'Squat'), [
        [top],
        [top],
        [{ weightG: kgToG(60), reps: 6 }],
      ])
      expect(moving.stalled).toBeNull()
      const early = await sessionsOf(await anExercise(alice, 'Press'), [[top], [top]])
      expect(early.stalled).toBeNull()
    })
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
    // Finished: a session takes its step when it is finished (ADR-0026).
    await user.wire(`/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    })
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

  /** A run (#14): the distance goes up a step, and its time with it, at the prescribed pace. */
  test('a run covered within its time goes further, at the same pace', async () => {
    const run = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Easy Run',
            tracking: 'distance_duration',
            muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
          }),
        })
      ).body,
    )
    const created = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Run' }) }))
        .body,
    )
    const workout = expectContract(
      Workout,
      (
        await alice.wire(`/workouts/${created.id}/plan`, {
          method: 'PUT',
          body: JSON.stringify({
            days: [
              {
                name: 'Run',
                entries: [
                  {
                    exerciseId: run.id,
                    progression: { kind: 'linear_distance', incrementMm: 500_000 },
                    sets: [{ targetDistanceMm: 5_000_000, targetDurationS: 1800 }],
                  },
                ],
              },
            ],
          }),
        })
      ).body,
    )
    const entry = workout.days[0]?.entries[0]
    const session = expectContract(
      WorkoutSession,
      (await startSession(alice, { workoutId: workout.id, dayId: workout.days[0]?.id })).body,
    )
    await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({
        exerciseId: run.id,
        entryId: entry?.id,
        distanceMm: 5_000_000,
        durationS: 1770,
      }),
    })
    await alice.wire(`/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    })

    const [suggestion] = expectContract(
      Suggestions,
      (await alice.wire(`/workouts/${workout.id}/progression`)).body,
    )
    expect(suggestion?.rule).toEqual({
      kind: 'linear_distance',
      incrementMm: 500_000,
      afterSuccesses: 1,
    })
    expect(suggestion?.changed).toBe(true)
    expect([suggestion?.suggested.distanceMm, suggestion?.suggested.durationS]).toEqual([
      5_500_000, 1980,
    ])
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
 * What a session asks of each entry — what the logger is pre-filled with: the plan's prescription
 * carried forward over the sessions BEFORE this one, and what was done last time. See `EntryTarget`.
 */
describe("a session's targets", () => {
  const Targets = z.array(EntryTarget)
  const targetsOf = async (user: TestUser, sessionId: string) =>
    expectContract(Targets, (await user.wire(`/sessions/${sessionId}/targets`)).body)

  /** Starts the workout's day, logs a warm-up and `reps` at 60 kg — and finishes it, unless told. */
  async function aSession(
    user: TestUser,
    workout: Workout,
    reps: number[],
    finish = true,
  ): Promise<string> {
    const entry = workout.days[0]?.entries[0]
    if (entry === undefined) throw new Error('the workout has no entry')
    const session = expectContract(
      WorkoutSession,
      (await startSession(user, { workoutId: workout.id, dayId: workout.days[0]?.id })).body,
    )
    const log = async (body: Record<string, unknown>) =>
      await user.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId: entry.exerciseId, entryId: entry.id, ...body }),
      })
    await log({ weightG: kgToG(20), reps: 10, isWarmup: true })
    for (const count of reps) await log({ weightG: kgToG(60), reps: count })
    if (finish) await finishSession(user, session.id)
    return session.id
  }

  const sets = (...reps: number[]) =>
    reps.map((count) => ({ reps: count, weightG: kgToG(60), durationS: null, distanceMm: null }))

  /**
   * A past mistake fixed (#31): 8 reps typed for 7 earned a rep more; corrected, the rep is gone
   * and last time says 7 — carried over the sessions as they stand, never as first logged.
   */
  test('follow a set of an earlier session corrected, or the session deleted', async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    const earlier = await aSession(alice, workout, [8, 8, 8])
    const id = await aSession(alice, workout, [], false)
    expect((await targetsOf(alice, id))[0]?.target.reps).toBe(9)

    const read = expectContract(WorkoutSession, (await alice.wire(`/sessions/${earlier}`)).body)
    for (const log of read.logs.filter((l) => !l.isWarmup)) {
      const fixed = await alice.wire(`/sessions/${earlier}/logs/${log.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reps: 7 }),
      })
      expect(fixed.status).toBe(200)
    }
    const [after] = await targetsOf(alice, id)
    expect(after?.target.reps).toBe(8)
    expect(after?.changed).toBe(false)
    expect(after?.last).toEqual(sets(7, 7, 7))

    expect((await alice.wire(`/sessions/${earlier}`, { method: 'DELETE' })).status).toBe(200)
    expect((await targetsOf(alice, id))[0]?.last).toBeNull()
  })

  test('with no history: the prescription, unchanged, and no last time', async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    const id = await aSession(alice, workout, [], false)

    const [target] = await targetsOf(alice, id)
    expect(target?.entryId).toBe(workout.days[0]?.entries[0]?.id)
    expect(target?.target).toEqual(target?.prescribed)
    expect(target?.target.reps).toBe(8)
    expect(target?.changed).toBe(false)
    expect(target?.last).toBeNull()
  })

  test('after a session that clears it, the next asks for more — and says what was done', async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    await aSession(alice, workout, [8, 8, 8])
    const next = await aSession(alice, workout, [], false)

    const [target] = await targetsOf(alice, next)
    expect(target?.prescribed.reps).toBe(8)
    expect(target?.target.reps).toBe(9)
    expect(target?.target.weightG).toBe(kgToG(60))
    expect(target?.changed).toBe(true)
    // Working sets only, in order: the warm-up is not last time's work.
    expect(target?.last).toEqual(sets(8, 8, 8))
  })

  /**
   * Regression guard for the design: counted with its own sets, a session whose sets had all hit
   * would offer its NEXT set the advanced target, mid-workout.
   */
  test("a session's own sets never move its target", async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    const id = await aSession(alice, workout, [8, 8, 8], false)

    const [target] = await targetsOf(alice, id)
    expect(target?.target.reps).toBe(8)
    expect(target?.changed).toBe(false)
    expect(target?.last).toBeNull()
  })

  test('the plan itself is not written to', async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    await aSession(alice, workout, [8, 8, 8])
    await targetsOf(alice, await aSession(alice, workout, [], false))

    const plan = expectContract(Workout, (await alice.wire(`/workouts/${workout.id}`)).body)
    const working = plan.days[0]?.entries[0]?.sets.filter((s) => !s.isWarmup)
    expect(working?.map((s) => s.target.reps)).toEqual([8, 8, 8])
  })

  /** Last time is the exercise's, wherever it was logged — a session without a plan included. */
  test('last time is the latest earlier session of the exercise, planned or not', async () => {
    const exerciseId = await anExercise(alice)
    const workout = await aPlannedWorkout(alice, exerciseId)
    await aSession(alice, workout, [8, 8, 8])

    const adHoc = expectContract(WorkoutSession, (await startSession(alice)).body)
    await alice.wire(`/sessions/${adHoc.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps: 5 }),
    })
    await finishSession(alice, adHoc.id)

    const [target] = await targetsOf(alice, await aSession(alice, workout, [], false))
    expect(target?.last).toEqual(sets(5))
  })

  test('a session without a plan asks nothing of any entry', async () => {
    const adHoc = expectContract(WorkoutSession, (await startSession(alice)).body)
    expect(await targetsOf(alice, adHoc.id)).toEqual([])
  })

  /** Without a rule nothing carries it forward, however well it went — but last time still shows. */
  test('an entry with no rule asks for its prescription after a session that clears it', async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    const entry = workout.days[0]?.entries[0]
    if (entry === undefined) throw new Error('the workout has no entry')
    const saved = await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [
          {
            id: workout.days[0]?.id,
            name: 'Push',
            entries: [
              {
                id: entry.id,
                exerciseId: entry.exerciseId,
                progression: { kind: 'none' },
                sets: [8, 8, 8].map((reps) => ({ targetReps: reps, targetWeightG: kgToG(60) })),
              },
            ],
          },
        ],
      }),
    })
    const plan = expectContract(Workout, saved.body)
    await aSession(alice, plan, [8, 8, 8])

    const [target] = await targetsOf(alice, await aSession(alice, plan, [], false))
    expect(target?.target).toEqual(target?.prescribed)
    expect(target?.target.reps).toBe(8)
    expect(target?.changed).toBe(false)
    expect(target?.last).toEqual(sets(8, 8, 8))
  })

  test("someone else's session is not there", async () => {
    const workout = await aPlannedWorkout(alice, await anExercise(alice))
    const id = await aSession(alice, workout, [], false)
    expect((await bob.wire(`/sessions/${id}/targets`)).status).toBe(404)
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
    const logged = await logWhole(
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

/**
 * Reps in reserve, whole (ADR-0027), stored as RPE 5 to 10. A half means nothing to the person
 * asked, so it is refused wherever it is sent — logged or prescribed — saying what to send instead.
 */
describe('reps in reserve, whole', () => {
  test('a set logged at a half is refused, saying what to send instead', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const res = await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps: 5, reserve: 1.5 }),
    })
    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body)).toContain('Reps in reserve are whole, none to five')
  })

  /**
   * The column holds the stored scale too, for a write that never passes the contract: a seed, a
   * fix. Past the column type, a raw write is the only way to send it an RPE at all.
   */
  test('the database refuses a stored RPE off the scale written past the API', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const logged = expectContract(
      SetLog,
      (
        await alice.wire(`/sessions/${session.id}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps: 5, reserve: 2 }),
        })
      ).body,
    )
    /** What refusing it says. Drizzle wraps the driver's error; its `cause` names the check. */
    const refusal = async (rpe: number) =>
      await db
        .update(setLogs)
        .set({ reserve: sql`${rpe}` })
        .where(eq(setLogs.id, logged.id))
        .then(
          () => null,
          (error: unknown) => error,
        )
    const byTheCheck = { cause: { constraint_name: 'set_logs_rpe_ck' } }
    expect(await refusal(8.5)).toMatchObject(byTheCheck)
    expect(await refusal(4)).toMatchObject(byTheCheck)
  })

  /** Stored as RPE, read back as the reserve it is: the column converts both ways, NULL alone. */
  test.each([0, 5])(
    'a set at the edge of the scale, %p in reserve, is logged and read back',
    async (reserve) => {
      const exerciseId = await anExercise(alice)
      const session = expectContract(WorkoutSession, (await startSession(alice)).body)
      const res = await alice.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps: 5, reserve }),
      })
      expect(expectContract(SetLog, res.body).reserve).toBe(reserve)
      const stored = await db
        .select({ rpe: sql<string>`${setLogs.reserve}::text` })
        .from(setLogs)
        .where(eq(setLogs.sessionId, session.id))
      expect(stored.map((r) => Number(r.rpe))).toEqual([10 - reserve])
      const read = expectContract(
        WorkoutSession,
        (await alice.wire(`/sessions/${session.id}`)).body,
      )
      expect(read.logs.map((l) => l.reserve)).toEqual([reserve])
    },
  )

  test("a plan's target off the scale is refused", async () => {
    const exerciseId = await anExercise(alice)
    const created = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Reserve' }) }))
        .body,
    )
    const res = await alice.wire(`/workouts/${created.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [
          { name: 'Day', entries: [{ exerciseId, sets: [{ targetReps: 5, targetReserve: 6 }] }] },
        ],
      }),
    })
    expect(res.status).toBe(422)
  })

  test.each([-1, 6, 1.5])('a set %p in reserve is refused', async (reserve) => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const res = await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps: 5, reserve }),
    })
    expect(res.status).toBe(422)
  })

  /** RPE is no longer a name anything past the column answers to (ADR-0027). */
  test('a set sent an RPE is refused, as a field nobody reads', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const res = await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps: 5, rpe: 8 }),
    })
    expect(res.status).toBe(422)
  })

  test("a plan's target at a half is refused", async () => {
    const exerciseId = await anExercise(alice)
    const created = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Reserve' }) }))
        .body,
    )
    const saved = await alice.wire(`/workouts/${created.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [
          {
            name: 'Day',
            entries: [
              {
                exerciseId,
                sets: [{ targetReps: 5, targetWeightG: kgToG(60), targetReserve: 2.5 }],
              },
            ],
          },
        ],
      }),
    })
    expect(saved.status).toBe(422)
    expect(JSON.stringify(saved.body)).toContain('Reps in reserve are whole, none to five')
  })
})

/**
 * The workout screen asks reserve after a set, not before (#24): how hard it was is said once it is
 * done — and, a past mistake being fixable (#31), after the session is finished too.
 */
describe("a set's reserve, said after it", () => {
  test('sets the reserve of a set already logged, and answers it as read', async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const set = expectContract(
      SetLog,
      (
        await alice.wire(`/sessions/${session.id}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, weightG: kgToG(100), reps: 5 }),
        })
      ).body,
    )
    expect(set.reserve).toBeNull()

    const amend = (reserve: number | null) =>
      alice.wire(`/sessions/${session.id}/logs/${set.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reserve }),
      })
    expect(expectContract(SetLog, (await amend(2)).body)).toMatchObject({
      id: set.id,
      reserve: 2,
      reps: 5,
    })

    await finishSession(alice, session.id)
    expect(expectContract(SetLog, (await amend(1)).body).reserve).toBe(1)
  })

  test("is a 404 for a set of another session, or someone else's", async () => {
    const exerciseId = await anExercise(alice)
    const session = expectContract(WorkoutSession, (await startSession(alice)).body)
    const set = expectContract(
      SetLog,
      (
        await alice.wire(`/sessions/${session.id}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, weightG: kgToG(100), reps: 5 }),
        })
      ).body,
    )
    const bobs = expectContract(WorkoutSession, (await startSession(bob)).body)
    const patch = { method: 'PATCH', body: JSON.stringify({ reserve: 2 }) }
    expect((await alice.wire(`/sessions/${bobs.id}/logs/${set.id}`, patch)).status).toBe(404)
    expect((await bob.wire(`/sessions/${session.id}/logs/${set.id}`, patch)).status).toBe(404)
  })
})

/** A personal best is marked as it is logged (#24) — by the server, which holds the history. */
describe('personal bests', () => {
  const logAt = async (sessionId: string, exerciseId: string, kg: number, isWarmup = false) =>
    expectContract(
      SetLog,
      (
        await alice.wire(`/sessions/${sessionId}/logs`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, weightG: kgToG(kg), reps: 5, isWarmup }),
        })
      ).body,
    )

  test('a set better than every earlier one is a best; the first time, a warm-up, or a match is not', async () => {
    const exerciseId = await anExercise(alice)
    const first = expectContract(WorkoutSession, (await startSession(alice)).body)
    expect((await logAt(first.id, exerciseId, 100)).personalBest).toBe(false)
    await finishSession(alice, first.id)

    const second = expectContract(WorkoutSession, (await startSession(alice)).body)
    expect((await logAt(second.id, exerciseId, 140, true)).personalBest).toBe(false)
    expect((await logAt(second.id, exerciseId, 100)).personalBest).toBe(false)
    expect((await logAt(second.id, exerciseId, 105)).personalBest).toBe(true)
    // Against the sets before it in this session too.
    expect((await logAt(second.id, exerciseId, 105)).personalBest).toBe(false)

    const read = expectContract(SessionDetail, (await alice.wire(`/sessions/${second.id}`)).body)
    expect(read.logs.map((l) => l.personalBest)).toEqual([false, false, true, false])
  })

  test("judged against the athlete's own history only", async () => {
    const exerciseId = await anExercise(alice)
    const crew = expectContract(
      GroupMembership,
      (await alice.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Crew' }) }))
        .body,
    )
    await alice.wire(`/groups/${crew.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'reader' }),
    })
    await alice.wire(`/exercises/${exerciseId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toGroupId: crew.id }),
    })
    const bobs = expectContract(WorkoutSession, (await startSession(bob)).body)
    const bobsSet = await bob.wire(`/sessions/${bobs.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId, weightG: kgToG(50), reps: 5 }),
    })
    expect(bobsSet.status).toBe(200)
    const mine = expectContract(WorkoutSession, (await startSession(alice)).body)
    // Bob's lighter set does not make Alice's first one a best: she has nothing earlier to beat.
    expect((await logAt(mine.id, exerciseId, 100)).personalBest).toBe(false)
  })
})
