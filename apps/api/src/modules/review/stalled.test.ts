import { beforeEach, expect, test } from 'bun:test'
import { type Effort, Exercise, type TrackingMode, WorkoutSession } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestUser, makeApi } from '../../test/harness.ts'
import { resolveCaller } from '../../plugins/auth.ts'
import { trainingReview } from './service.ts'

/**
 * `stalled` in every tracking mode. It reports the one effort an exercise keeps repeating, whole and
 * in base units, with the mode that says how to read it. It used to report a best weight in kg and
 * a best reps, which the MCP formatter turned back into grams with no mode, no duration and no
 * distance: a weighted pull-up read as a 20 kg lift and a plank as nothing. And a movement with no
 * weight once reported "0kg" — Drizzle skips `mapWith` for SQL NULL, so it is null, never NaN.
 */

let alice: TestUser

beforeEach(async () => {
  alice = await (await makeApi()).as('alice')
})

async function anExercise(tracking: TrackingMode, name = 'Pull-up'): Promise<string> {
  const res = await alice.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({
      name,
      tracking,
      muscles: [{ muscle: 'latissimus_dorsi', loadPct: 100 }],
    }),
  })
  return expectContract(Exercise, res.body).id
}

/** One session per set, each logging that one set. */
async function sessionsLogging(sets: readonly Record<string, unknown>[]): Promise<void> {
  for (const set of sets) {
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

const threeIdenticalSessions = async (set: Record<string, unknown>): Promise<void> => {
  await sessionsLogging([set, set, set])
}

async function review() {
  const caller = await resolveCaller(`Bearer ${alice.token}`)
  if (caller === null) throw new Error('alice could not be resolved')
  return await trainingReview(caller, 4)
}

const NOTHING: Effort = { reps: null, weightG: null, durationS: null, distanceMm: null }

const EVERY_MODE: readonly [TrackingMode, Effort][] = [
  ['weight_reps', { ...NOTHING, reps: 8, weightG: 60_000 }],
  ['bodyweight_reps', { ...NOTHING, reps: 6, weightG: 20_000 }],
  ['bodyweight_reps', { ...NOTHING, reps: 8 }],
  ['duration', { ...NOTHING, durationS: 60 }],
  ['distance_duration', { ...NOTHING, distanceMm: 5_000_000, durationS: 1800 }],
]

test.each(EVERY_MODE)(
  'a stalled %s movement reports its effort whole: %o',
  async (tracking, effort) => {
    const exerciseId = await anExercise(tracking)
    await threeIdenticalSessions({ exerciseId, ...effort })

    expect((await review()).stalled).toEqual([
      { exercise: { name: 'Pull-up', tracking }, sessions: 3, effort },
    ])
  },
)

/**
 * Regression: the distinct-effort tuple was `(weight_g, reps, duration_s)` — distance was left out,
 * so a run that went further in the same time every session read as stalled, and the AI was told
 * to change the one thing that was working. The pull-up bug again, on the dimension it missed.
 */
test('a run that goes further each session has not stalled', async () => {
  const exerciseId = await anExercise('distance_duration', 'Run')
  await sessionsLogging(
    [5_000_000, 5_500_000, 6_000_000].map((distanceMm) => ({
      exerciseId,
      distanceMm,
      durationS: 1800,
    })),
  )

  expect((await review()).stalled).toEqual([])
})
