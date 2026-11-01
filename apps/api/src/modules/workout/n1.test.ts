import { beforeEach, describe, expect, test } from 'bun:test'
import { Exercise, Workout, WorkoutSession, planInputFrom } from '@cedo/contract'
import { withQueryCount } from '../../db/client.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import * as ProgressionService from '../progression/service.ts'
import { history } from '../session/history.ts'
import { get as getSession } from '../session/plan.ts'
import * as WorkoutService from './service.ts'
import { own } from '../coaching/training.ts'

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

/** Finishes a session, so the next can start: one is in progress at a time. */
async function finish(id: string): Promise<void> {
  await alice.wire(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ endedAt: new Date().toISOString() }),
  })
}

async function exerciseIds(count: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const res = await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify({
        name: `Lift ${i}`,
        muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
      }),
    })
    ids.push(expectContract(Exercise, res.body).id)
  }
  return ids
}

/** `days` × `entriesPerDay` × 3 sets, drawing from `ids` in rotation. */
async function planned(days: number, entriesPerDay: number, ids: string[]): Promise<string> {
  const created = expectContract(
    Workout,
    (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Plan' }) }))
      .body,
  )

  await alice.wire(`/workouts/${created.id}/plan`, {
    method: 'PUT',
    body: JSON.stringify({
      days: Array.from({ length: days }, (_unusedDay, d) => ({
        name: `Day ${d}`,
        entries: Array.from({ length: entriesPerDay }, (_unusedEntry, e) => ({
          exerciseId: ids[(d * entriesPerDay + e) % ids.length],
          progression: { kind: 'linear', incrementG: 2500, afterSuccesses: 1 },
          sets: [{ targetReps: 8 }, { targetReps: 8 }, { targetReps: 8 }],
        })),
      })),
    }),
  })
  return created.id
}

/**
 * The three-level plan is the worst N+1 risk in the codebase: days, then entries, then sets, with a
 * full exercise on every entry. The invariant is that the query count does not change with the size
 * of the plan. See docs/adr/0018-n1-detection.md.
 */
describe('reads do not N+1', () => {
  test('fetching a plan costs the same for 1 day × 1 entry as for 6 days × 8 entries', async () => {
    const ids = await exerciseIds(12)

    const small = await planned(1, 1, ids)
    const smallCount = await withQueryCount(() => WorkoutService.get(own(alice.caller), small))

    const large = await planned(6, 8, ids)
    const largeCount = await withQueryCount(() => WorkoutService.get(own(alice.caller), large))

    expect(smallCount.result.days).toHaveLength(1)
    expect(largeCount.result.days).toHaveLength(6)
    expect(largeCount.result.days.flatMap((d) => d.entries)).toHaveLength(48)

    expect(largeCount.count).toBe(smallCount.count)
    // summary + day count + days + entries + sets + exercises + favourites + muscles + media
    // + what the caller has (#35)
    expect(largeCount.count).toBeLessThanOrEqual(10)
  })

  /**
   * A re-save that KEEPS every day and entry is the expensive shape — parked, moved, and its sets
   * rewritten — so that is the one measured, at both sizes.
   */
  test('re-saving a plan costs the same for 1 day × 1 entry as for 6 days × 8 entries', async () => {
    const ids = await exerciseIds(12)
    const resave = async (workoutId: string) => {
      const current = await WorkoutService.get(own(alice.caller), workoutId)
      return await withQueryCount(() =>
        WorkoutService.replacePlan(alice.caller, workoutId, planInputFrom(current)),
      )
    }

    const small = await resave(await planned(1, 1, ids))
    const large = await resave(await planned(6, 8, ids))

    expect(large.result.days.flatMap((d) => d.entries)).toHaveLength(48)
    expect(large.count).toBe(small.count)
  })

  test('listing workouts costs the same for 1 as for 20', async () => {
    const ids = await exerciseIds(2)

    await planned(1, 1, ids)
    const one = await withQueryCount(() =>
      WorkoutService.list(alice.caller, { limit: 50, scope: 'all' }),
    )

    for (let i = 0; i < 19; i++) {
      // oxlint-disable-next-line no-await-in-loop
      await planned(1, 1, ids)
    }
    const many = await withQueryCount(() =>
      WorkoutService.list(alice.caller, { limit: 50, scope: 'all' }),
    )

    expect(one.result.items).toHaveLength(1)
    expect(many.result.items).toHaveLength(20)
    expect(many.count).toBe(one.count)
    // The rows, plus one grouped query for every day count on the page.
    expect(many.count).toBeLessThanOrEqual(2)
  })

  test('progression suggestions cost the same for 1 entry as for 48', async () => {
    const ids = await exerciseIds(12)

    const small = await planned(1, 1, ids)
    const smallCount = await withQueryCount(() =>
      ProgressionService.suggestForWorkout(alice.caller, small),
    )

    const large = await planned(6, 8, ids)
    const largeCount = await withQueryCount(() =>
      ProgressionService.suggestForWorkout(alice.caller, large),
    )

    expect(smallCount.result).toHaveLength(1)
    expect(largeCount.result).toHaveLength(48)

    expect(largeCount.count).toBe(smallCount.count)
    // The workout, its entries, their prescribed sets, the caller's logs, and what they have to
    // train with — the weights they can load (#36).
    expect(largeCount.count).toBeLessThanOrEqual(5)
  })

  test('session history costs the same for 1 session as for 15', async () => {
    const [exerciseId] = await exerciseIds(1)
    if (exerciseId === undefined) throw new Error('no exercise')

    const logOne = async () => {
      const session = await alice.wire('/sessions', { method: 'POST', body: '{}' })
      const { id } = expectContract(WorkoutSession, session.body)
      await alice.wire(`/sessions/${id}/logs`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, reps: 8, weightG: 60_000 }),
      })
      await finish(id)
    }

    await logOne()
    const one = await withQueryCount(() => history(own(alice.caller), exerciseId, { limit: 20 }))

    for (let i = 0; i < 14; i++) {
      // oxlint-disable-next-line no-await-in-loop
      await logOne()
    }
    const many = await withQueryCount(() => history(own(alice.caller), exerciseId, { limit: 20 }))

    expect(one.result.sessions).toHaveLength(1)
    expect(many.result.sessions).toHaveLength(15)
    expect(many.count).toBe(one.count)
    expect(many.count).toBeLessThanOrEqual(2)
  })

  /** A live session reads the day it follows: the cost of a day, not of the plan it is in. */
  test('a session costs the same following a 1-entry day as an 8-entry day of a 6-day plan', async () => {
    const ids = await exerciseIds(12)
    const sessionOn = async (workoutId: string) => {
      const day = (await WorkoutService.get(own(alice.caller), workoutId)).days[0]
      const res = await alice.wire('/sessions', {
        method: 'POST',
        body: JSON.stringify({ workoutId, dayId: day?.id }),
      })
      return expectContract(WorkoutSession, res.body).id
    }

    // Each finished once read: one session is in progress at a time.
    const small = await sessionOn(await planned(1, 1, ids))
    const smallCount = await withQueryCount(() => getSession(own(alice.caller), small))
    await finish(small)
    const large = await sessionOn(await planned(6, 8, ids))
    const largeCount = await withQueryCount(() => getSession(own(alice.caller), large))
    await finish(large)

    const entries = (read: typeof smallCount.result) =>
      read.plan?.reachable === true ? read.plan.day.entries.length : 0
    expect(entries(smallCount.result)).toBe(1)
    expect(entries(largeCount.result)).toBe(8)
    expect(largeCount.count).toBe(smallCount.count)

    // The day costs a fixed eight over a session that follows none: day, entries, sets, and the
    // five exercise reads — the fifth what the caller has, for whether each is doable (#35).
    const adHoc = expectContract(
      WorkoutSession,
      (await alice.wire('/sessions', { method: 'POST', body: '{}' })).body,
    ).id
    const adHocCount = await withQueryCount(() => getSession(own(alice.caller), adHoc))
    expect(adHocCount.result.plan).toBeNull()
    expect(largeCount.count).toBe(adHocCount.count + 8)
  })
})
