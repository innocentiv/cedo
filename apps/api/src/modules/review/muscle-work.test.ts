import { beforeEach, expect, test } from 'bun:test'
import { Exercise, type TrackingMode, WorkoutSession } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestUser, makeApi } from '../../test/harness.ts'
import { resolveCaller } from '../../plugins/auth.ts'
import { trainingReview } from './service.ts'

/**
 * The work each muscle got, in working sets by load share. It used to be weight × reps alone, which
 * a plank, a run or an unweighted pull-up cannot register: a muscle trained only by those read
 * "0 kg", as if it had not been trained at all. See GLOSSARY.md, "Working sets per muscle".
 */

let alice: TestUser

beforeEach(async () => {
  alice = await (await makeApi()).as('alice')
})

async function anExercise(
  name: string,
  tracking: TrackingMode,
  muscles: readonly { muscle: string; loadPct: number }[],
): Promise<string> {
  const res = await alice.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({ name, tracking, muscles }),
  })
  return expectContract(Exercise, res.body).id
}

/** One session logging these sets, in order. */
async function aSession(sets: readonly Record<string, unknown>[]): Promise<void> {
  const session = expectContract(
    WorkoutSession,
    (await alice.wire('/sessions', { method: 'POST', body: '{}' })).body,
  )
  for (const [setIndex, set] of sets.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- in order: each set is numbered by its index.
    await alice.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ setIndex, ...set }),
    })
  }
}

async function workOf(muscle: string) {
  const caller = await resolveCaller(`Bearer ${alice.token}`)
  if (caller === null) throw new Error('alice could not be resolved')
  return (await trainingReview(caller, 4)).muscleWork.find((m) => m.muscle === muscle)
}

test('work with no load counts as the sets it was, with nothing lifted', async () => {
  const plank = await anExercise('Plank', 'duration', [
    { muscle: 'rectus_abdominis', loadPct: 100 },
  ])
  const pullUp = await anExercise('Pull-up', 'bodyweight_reps', [
    { muscle: 'latissimus_dorsi', loadPct: 100 },
  ])
  await aSession([
    { exerciseId: plank, durationS: 60 },
    { exerciseId: plank, durationS: 60 },
    { exerciseId: plank, durationS: 60 },
    { exerciseId: pullUp, reps: 8 },
    { exerciseId: pullUp, reps: 8 },
  ])

  expect(await workOf('rectus_abdominis')).toMatchObject({ workingSets: 3, liftedG: 0 })
  expect(await workOf('latissimus_dorsi')).toMatchObject({ workingSets: 2, liftedG: 0 })
})

test('a set counts toward each muscle by its share of the load', async () => {
  const bench = await anExercise('Bench', 'weight_reps', [
    { muscle: 'pectoralis_major', loadPct: 70 },
    { muscle: 'triceps_brachii', loadPct: 30 },
  ])
  await aSession([{ exerciseId: bench, weightG: 100_000, reps: 5 }])

  expect(await workOf('pectoralis_major')).toMatchObject({ workingSets: 0.7, liftedG: 350_000 })
  expect(await workOf('triceps_brachii')).toMatchObject({ workingSets: 0.3, liftedG: 150_000 })
})

test('a warm-up is not work', async () => {
  const squat = await anExercise('Squat', 'weight_reps', [{ muscle: 'quadriceps', loadPct: 100 }])
  await aSession([
    { exerciseId: squat, weightG: 40_000, reps: 5, isWarmup: true },
    { exerciseId: squat, weightG: 100_000, reps: 5 },
  ])

  expect(await workOf('quadriceps')).toMatchObject({ workingSets: 1, liftedG: 500_000 })
})
