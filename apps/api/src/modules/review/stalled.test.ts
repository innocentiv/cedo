import { beforeEach, expect, test } from 'bun:test'
import { Exercise, WorkoutSession } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestUser, makeApi } from '../../test/harness.ts'
import { resolveCaller } from '../../plugins/auth.ts'
import { trainingReview } from './service.ts'

/**
 * `stalled` on movements that log no weight. Their best weight is SQL NULL, and the code assumed
 * `mapWith(Number)` turns NULL into NaN — Drizzle skips the decoder for NULL, so it stayed null,
 * slipped past the NaN check, and `Math.round(null)` reported "3 sessions at 0kg" for a pull-up.
 */

let alice: TestUser

beforeEach(async () => {
  alice = await (await makeApi()).as('alice')
})

async function anExercise(tracking: string): Promise<string> {
  const res = await alice.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Pull-up',
      tracking,
      muscles: [{ muscle: 'latissimus_dorsi', loadPct: 100 }],
    }),
  })
  return expectContract(Exercise, res.body).id
}

async function threeIdenticalSessions(set: Record<string, unknown>): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    const session = expectContract(
      WorkoutSession,
      (await alice.wire('/sessions', { method: 'POST', body: '{}' })).body,
    )
    await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ setIndex: 0, ...set }),
    })
  }
}

async function review() {
  const caller = await resolveCaller(`Bearer ${alice.token}`)
  if (caller === null) throw new Error('alice could not be resolved')
  return await trainingReview(caller, 4)
}

test('a bodyweight movement that stalled reports no weight, not 0 kg', async () => {
  const exerciseId = await anExercise('bodyweight_reps')
  await threeIdenticalSessions({ exerciseId, reps: 8 })

  const [stall] = (await review()).stalled
  expect(stall?.exercise).toBe('Pull-up')
  expect(stall?.bestWeightKg).toBeNull()
  expect(stall?.bestReps).toBe(8)
})

test('a duration movement that stalled reports neither weight nor reps', async () => {
  const exerciseId = await anExercise('duration')
  await threeIdenticalSessions({ exerciseId, durationS: 60 })

  const [stall] = (await review()).stalled
  expect(stall?.bestWeightKg).toBeNull()
  expect(stall?.bestReps).toBeNull()
})
