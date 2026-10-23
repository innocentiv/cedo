import { beforeEach, describe, expect, test } from 'bun:test'
import {
  ApiError,
  Exercise,
  SessionLogInput,
  SetLog,
  Workout,
  WorkoutSession,
  WorkoutSessionSummary,
  page,
} from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestUser, makeApi } from '../../test/harness.ts'
import { trainingReview } from '../review/service.ts'
import { logWhole } from './start.ts'
import { own } from './service.ts'

/**
 * Assistance — a band, an assisted machine — is NEGATIVE added weight, on a bodyweight movement
 * only (#19): one scale with added load. A negative barbell is a mistake, refused where the
 * exercise is known; and help is never counted as weight lifted.
 */

let alice: TestUser

beforeEach(async () => {
  alice = await (await makeApi()).as('alice')
})

async function anExercise(tracking: 'bodyweight_reps' | 'weight_reps'): Promise<string> {
  const res = await alice.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({
      name: tracking === 'bodyweight_reps' ? 'Band Pull-Up' : 'Bench Press',
      tracking,
      muscles: [{ muscle: 'latissimus_dorsi', loadPct: 100 }],
    }),
  })
  return expectContract(Exercise, res.body).id
}

const startSession = async () =>
  expectContract(
    WorkoutSession,
    (await alice.wire('/sessions', { method: 'POST', body: '{}' })).body,
  )

const logSet = async (sessionId: string, exerciseId: string, weightG: number) =>
  await alice.wire(`/sessions/${sessionId}/logs`, {
    method: 'POST',
    body: JSON.stringify({ exerciseId, weightG, reps: 10 }),
  })

const savePlan = async (exerciseId: string, targetWeightG: number) => {
  const workout = expectContract(
    Workout,
    (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Pull' }) }))
      .body,
  )
  return await alice.wire(`/workouts/${workout.id}/plan`, {
    method: 'PUT',
    body: JSON.stringify({
      days: [
        { name: 'Pull', entries: [{ exerciseId, sets: [{ targetReps: 10, targetWeightG }] }] },
      ],
    }),
  })
}

describe('a set logged with assistance', () => {
  test('is kept on a bodyweight movement', async () => {
    const pullUp = await anExercise('bodyweight_reps')
    const session = await startSession()
    const log = expectContract(SetLog, (await logSet(session.id, pullUp, -20_000)).body)
    expect(log.weightG).toBe(-20_000)
  })

  test('is refused on a weight lift, by its field', async () => {
    const bench = await anExercise('weight_reps')
    const session = await startSession()
    const refused = await logSet(session.id, bench, -20_000)
    expect(refused.status).toBe(422)
    expect(expectContract(ApiError, refused.body).error.details?.map((d) => d.path)).toEqual([
      'weightG',
    ])
  })

  /** Help is not load: lifted counts it as nothing, never as a negative. */
  test('is not weight lifted', async () => {
    const pullUp = await anExercise('bodyweight_reps')
    const session = await startSession()
    await logSet(session.id, pullUp, -20_000)
    await alice.wire(`/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    })
    const [summary] = expectContract(
      page(WorkoutSessionSummary),
      (await alice.wire('/sessions')).body,
    ).items
    expect(summary?.liftedG).toBe(0)
  })

  test('is not weight lifted in the training review either — the set is, the help is not', async () => {
    const pullUp = await anExercise('bodyweight_reps')
    const session = await startSession()
    await logSet(session.id, pullUp, -20_000)
    const lats = (await trainingReview(own(alice.caller), 4)).muscleWork.top.find(
      (m) => m.muscle === 'latissimus_dorsi',
    )
    expect(lats?.weightedSets).toBe(1)
    expect(lats?.liftedG).toBe(0)
  })
})

/** The MCP's `session_log` writes a whole session through `logWhole`: held to the same rule. */
describe('a whole session logged at once, as the MCP does', () => {
  test('keeps assistance on a bodyweight movement, and refuses it on a weight lift', async () => {
    const pullUp = await anExercise('bodyweight_reps')
    const bench = await anExercise('weight_reps')
    const whole = (exerciseId: string) =>
      SessionLogInput.parse({ sets: [{ exerciseId, weightG: -20_000, reps: 8 }] })

    const kept = await logWhole(alice.caller, whole(pullUp))
    expect(kept.logs[0]?.weightG).toBe(-20_000)
    const refused = await logWhole(alice.caller, whole(bench)).then(
      () => null,
      (error: unknown) => error,
    )
    expect(refused).toMatchObject({ code: 'validation_failed' })
  })
})

describe('a plan prescribing assistance', () => {
  test('is saved for a bodyweight movement', async () => {
    const pullUp = await anExercise('bodyweight_reps')
    const saved = expectContract(Workout, (await savePlan(pullUp, -20_000)).body)
    expect(saved.days[0]?.entries[0]?.sets[0]?.target.weightG).toBe(-20_000)
  })

  test('is refused for a weight lift', async () => {
    const bench = await anExercise('weight_reps')
    const refused = await savePlan(bench, -20_000)
    expect(refused.status).toBe(422)
    expect(expectContract(ApiError, refused.body).error.message).toContain('assist')
  })
})
