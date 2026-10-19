import { beforeEach, expect, test } from 'bun:test'
import type { Effort, TrackingMode } from '@cedo/contract'
import { makeApi } from '../../test/harness.ts'
import { reviewFixture } from './review-fixture.ts'

/**
 * `stalled` in every tracking mode. It reports the one effort an exercise keeps repeating, whole and
 * in base units, with the mode that says how to read it. It used to report a best weight in kg and
 * a best reps, which the MCP formatter turned back into grams with no mode, no duration and no
 * distance: a weighted pull-up read as a 20 kg lift and a plank as nothing.
 */

let fixture: ReturnType<typeof reviewFixture>

beforeEach(async () => {
  fixture = reviewFixture(await (await makeApi()).as('alice'))
})

type LoggedSet = Partial<Effort> & { readonly exerciseId: string }

/** One session per set, each logging that one set. */
async function sessionsLogging(sets: readonly LoggedSet[]): Promise<void> {
  for (const set of sets) {
    // oxlint-disable-next-line no-await-in-loop -- one session after another, as they happened.
    await fixture.aSession([set])
  }
}

async function threeIdenticalSessions(set: LoggedSet): Promise<void> {
  await sessionsLogging([set, set, set])
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
    const exerciseId = await fixture.anExercise({ tracking })
    await threeIdenticalSessions({ exerciseId, ...effort })

    expect((await fixture.review()).stalled).toEqual([
      { exercise: { name: 'Movement', tracking }, sessions: 3, effort },
    ])
  },
)

/** Regression: distance was left out of the stall test. See `oneEffort` in ./service.ts. */
test('a run that goes further each session has not stalled', async () => {
  const exerciseId = await fixture.anExercise({ name: 'Run', tracking: 'distance_duration' })
  await sessionsLogging(
    [5_000_000, 5_500_000, 6_000_000].map((distanceMm) => ({
      exerciseId,
      distanceMm,
      durationS: 1800,
    })),
  )

  expect((await fixture.review()).stalled).toEqual([])
})
