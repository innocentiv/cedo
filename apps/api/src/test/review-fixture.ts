import { eq } from 'drizzle-orm'
import { Exercise, type TrackingMode, WorkoutSession, daysToMs } from '@cedo/contract'
import { db } from '../db/client.ts'
import { workoutSessions } from '../db/schema.ts'
import { own } from '../modules/coaching/training.ts'
import { trainingReview } from '../modules/review/service.ts'
import { resolveCaller } from '../plugins/auth.ts'
import { expectContract } from './contract.ts'
import type { TestUser } from './harness.ts'
import type { TrainingReview } from '@cedo/contract'

/** What the review's tests share: a person's exercises and sessions, made over the wire. */

interface ExerciseSpec {
  readonly name?: string
  readonly tracking?: TrackingMode
  readonly muscles?: readonly { readonly muscle: string; readonly loadPct: number }[]
}

async function finish(user: TestUser, sessionId: string): Promise<void> {
  await user.wire(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ endedAt: new Date().toISOString() }),
  })
}

export function reviewFixture(user: TestUser) {
  return {
    anExercise: async ({
      name = 'Movement',
      tracking = 'weight_reps',
      muscles = [{ muscle: 'latissimus_dorsi', loadPct: 100 }],
    }: ExerciseSpec = {}): Promise<string> => {
      const res = await user.wire('/exercises', {
        method: 'POST',
        body: JSON.stringify({ name, tracking, muscles }),
      })
      return expectContract(Exercise, res.body).id
    },

    /**
     * One session logging these sets, in order. `daysAgo` moves it back in time — into the window
     * before the one reviewed, for a trend — which only the database can do: a session starts now.
     */
    aSession: async (sets: readonly Record<string, unknown>[], daysAgo = 0): Promise<void> => {
      const session = expectContract(
        WorkoutSession,
        (await user.wire('/sessions', { method: 'POST', body: '{}' })).body,
      )
      for (const set of sets) {
        // oxlint-disable-next-line no-await-in-loop -- in order: the server numbers them as they come.
        await user.wire(`/sessions/${session.id}/logs`, {
          method: 'POST',
          body: JSON.stringify(set),
        })
      }
      // Finished, as past training is — and so the next can start: one is in progress at a time.
      await finish(user, session.id)
      if (daysAgo > 0) {
        const startedAt = new Date(Date.now() - daysToMs(daysAgo))
        await db
          .update(workoutSessions)
          .set({ startedAt, endedAt: new Date(startedAt.getTime() + 3_600_000) })
          .where(eq(workoutSessions.id, session.id))
      }
    },

    review: async (weeks = 4): Promise<TrainingReview> => {
      const caller = await resolveCaller(`Bearer ${user.token}`)
      if (caller === null) throw new Error(`${user.username} could not be resolved`)
      return await trainingReview(own(caller), weeks)
    },
  }
}
