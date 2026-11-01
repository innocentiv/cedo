import { beforeEach, describe, expect, test } from 'bun:test'
import { Exercise, SetLog, Workout, WorkoutSession } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

const post = async (path: string, body: unknown, method = 'POST') => {
  const res = await alice.wire(path, { method, body: JSON.stringify(body) })
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status}`)
  return res.body
}

/** A session following a day of one exercise: a warm-up, then three sets resting 90 s. */
async function following() {
  const squat = expectContract(
    Exercise,
    await post('/exercises', { name: 'Squat', muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
  )
  const workout = expectContract(Workout, await post('/workouts', { name: 'Legs' }))
  const set = { targetReps: 5, targetWeightG: 100_000 }
  const plan = expectContract(
    Workout,
    await post(
      `/workouts/${workout.id}/plan`,
      {
        days: [
          {
            name: 'A',
            entries: [
              {
                exerciseId: squat.id,
                restSeconds: 90,
                sets: [{ ...set, isWarmup: true }, set, set, set],
              },
            ],
          },
        ],
      },
      'PUT',
    ),
  )
  const day = plan.days[0]
  const entry = day?.entries[0]
  if (day === undefined || entry === undefined) throw new Error('no plan')
  const session = expectContract(
    WorkoutSession,
    await post('/sessions', { workoutId: workout.id, dayId: day.id }),
  )
  const log = async (isWarmup = false) =>
    expectContract(
      SetLog,
      await post(`/sessions/${session.id}/logs`, {
        exerciseId: squat.id,
        entryId: entry.id,
        weightG: 100_000,
        reps: 5,
        isWarmup,
      }),
    )
  return { id: session.id, log }
}

const restOf = async (id: string) =>
  expectContract(WorkoutSession, (await alice.wire(`/sessions/${id}`)).body).rest

const seconds = (rest: { since: string; endsAt: string } | null) =>
  rest === null ? null : (Date.parse(rest.endsAt) - Date.parse(rest.since)) / 1000

/** The rest, kept by the server as the app counts it (#38) — so it can be told with the app closed. */
describe('the rest a session has running', () => {
  test('starts with a working set, from when it was logged, for as long as its entry says', async () => {
    const s = await following()
    await s.log(true)
    // A warm-up is the ramp to the work, not what the rest is for.
    expect(await restOf(s.id)).toBeNull()
    const first = await s.log()
    const rest = await restOf(s.id)
    expect(rest?.since).toBe(first.loggedAt)
    expect(seconds(rest)).toBe(90)
  })

  test('within a superset round none runs; after the round, its last exercise’s', async () => {
    const lift = async (name: string) =>
      expectContract(
        Exercise,
        await post('/exercises', { name, muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
      )
    const [press, row] = [await lift('Press'), await lift('Row')]
    const workout = expectContract(Workout, await post('/workouts', { name: 'Pair' }))
    const set = { targetReps: 8, targetWeightG: 40_000 }
    const plan = expectContract(
      Workout,
      await post(
        `/workouts/${workout.id}/plan`,
        {
          days: [
            {
              name: 'A',
              entries: [
                { exerciseId: press.id, supersetGroup: 'A', restSeconds: 0, sets: [set, set] },
                { exerciseId: row.id, supersetGroup: 'A', restSeconds: 75, sets: [set, set] },
              ],
            },
          ],
        },
        'PUT',
      ),
    )
    const [first, second] = plan.days[0]?.entries ?? []
    if (first === undefined || second === undefined) throw new Error('no plan')
    const session = expectContract(
      WorkoutSession,
      await post('/sessions', { workoutId: workout.id, dayId: plan.days[0]?.id }),
    )
    const log = async (exerciseId: string, entryId: string) =>
      await post(`/sessions/${session.id}/logs`, { exerciseId, entryId, weightG: 40_000, reps: 8 })
    await log(press.id, first.id)
    expect(await restOf(session.id)).toBeNull()
    await log(row.id, second.id)
    expect(seconds(await restOf(session.id))).toBe(75)
  })

  test('a set logged with no plan rests the default two minutes', async () => {
    const squat = expectContract(
      Exercise,
      await post('/exercises', { name: 'Free', muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
    )
    const session = expectContract(WorkoutSession, await post('/sessions', {}))
    await post(`/sessions/${session.id}/logs`, { exerciseId: squat.id, reps: 5, weightG: 50_000 })
    expect(seconds(await restOf(session.id))).toBe(120)
  })

  test('+30 s moves its end; a change meant for an earlier rest changes nothing', async () => {
    const s = await following()
    await s.log()
    // Named by how many sets there were when tapped — never by a time, which a set sent without a
    // signal has from the phone, then from the server.
    await post(`/sessions/${s.id}/rest`, { sets: 1, change: 'extend' })
    expect(seconds(await restOf(s.id))).toBe(120)
    await s.log()
    // Sent late, after the next set began a rest of its own.
    await post(`/sessions/${s.id}/rest`, { sets: 1, change: 'extend' })
    expect(seconds(await restOf(s.id))).toBe(90)
  })

  test('skipped, it is kept as ended when it began — so a reload, or another device, reads it so', async () => {
    const s = await following()
    const first = await s.log()
    await post(`/sessions/${s.id}/rest`, { sets: 1, change: 'skip' })
    expect(await restOf(s.id)).toEqual({ since: first.loggedAt, endsAt: first.loggedAt })
  })

  test('undoing an older set keeps the rest running, and its +30 s', async () => {
    const s = await following()
    const first = await s.log()
    await s.log()
    await post(`/sessions/${s.id}/rest`, { sets: 2, change: 'extend' })
    await post(`/sessions/${s.id}/logs/${first.id}`, {}, 'DELETE')
    expect(seconds(await restOf(s.id))).toBe(120)
  })

  test('undoing its set, or finishing the session, ends it', async () => {
    const s = await following()
    const first = await s.log()
    // Undone, the set's rest goes with it: there is no working set before it.
    await post(`/sessions/${s.id}/logs/${first.id}`, {}, 'DELETE')
    expect(await restOf(s.id)).toBeNull()
    await s.log()
    expect(await restOf(s.id)).not.toBeNull()
    await post(`/sessions/${s.id}`, { endedAt: new Date().toISOString() }, 'PATCH')
    expect(await restOf(s.id)).toBeNull()
  })

  /** Corrected mid-session — over MCP's `session_fix_set`, or the PATCH — a set says its rest again. */
  test('correcting its set to a warm-up ends it; correcting a warm-up to work starts one', async () => {
    const s = await following()
    const warm = await s.log(true)
    const work = await s.log()
    expect(await restOf(s.id)).not.toBeNull()
    await post(`/sessions/${s.id}/logs/${work.id}`, { isWarmup: true }, 'PATCH')
    expect(await restOf(s.id)).toBeNull()
    await post(`/sessions/${s.id}/logs/${warm.id}`, { isWarmup: false }, 'PATCH')
    // The latest set is a warm-up still: no rest after it, whatever came before.
    expect(await restOf(s.id)).toBeNull()
    await post(`/sessions/${s.id}/logs/${work.id}`, { isWarmup: false }, 'PATCH')
    const rest = await restOf(s.id)
    expect(rest?.since).toBe(work.loggedAt)
    expect(seconds(rest)).toBe(90)
  })

  test("is one's own: another's session cannot be changed", async () => {
    const s = await following()
    await s.log()
    const bob = await h.as('bob')
    await bob.wire(`/sessions/${s.id}/rest`, {
      method: 'POST',
      body: JSON.stringify({ sets: 1, change: 'skip' }),
    })
    // Still its 90 s — skipped, it would have ended when it began.
    expect(seconds(await restOf(s.id))).toBe(90)
  })
})
