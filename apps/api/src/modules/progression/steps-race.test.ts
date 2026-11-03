import { beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { Exercise, ProgressionSuggestion, Workout, WorkoutSession } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestUser, makeApi } from '../../test/harness.ts'
import { amendLog } from '../session/set-writes.ts'
import { update } from '../session/write-session.ts'

/**
 * A person's steps are taken one write at a time (ADR-0026). A correction of an earlier session and
 * the finish of a later one, each re-taking steps in its own transaction, would otherwise read each
 * other's uncommitted state: the finish judging its session from the step the correction is about
 * to replace. Driven through the services at once — the in-process harness lines requests up — on
 * a warmed pool, which a test run alone would otherwise open one connection at a time.
 */

let alice: TestUser

beforeEach(async () => {
  alice = await (await makeApi()).as('alice')
})

const send = async (path: string, body: unknown, method = 'POST') => {
  const res = await alice.wire(path, { method, body: JSON.stringify(body) })
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status}`)
  return res.body
}

/** A plan, a finished session of 8 × 3, and a later one of 9 × 3 still in progress. */
async function poised() {
  const lift = expectContract(
    Exercise,
    await send('/exercises', {
      name: `Row ${crypto.randomUUID()}`,
      muscles: [{ muscle: 'latissimus_dorsi', loadPct: 100 }],
    }),
  )
  const workout = expectContract(Workout, await send('/workouts', { name: 'Pull' }))
  const set = { targetReps: 8, targetWeightG: 55_000 }
  const plan = expectContract(
    Workout,
    await send(
      `/workouts/${workout.id}/plan`,
      {
        days: [
          {
            name: 'A',
            entries: [
              {
                exerciseId: lift.id,
                sets: [set, set, set],
                progression: { kind: 'double', repRange: [8, 12], incrementG: 2500 },
              },
            ],
          },
        ],
      },
      'PUT',
    ),
  )
  const dayId = plan.days[0]?.id ?? ''
  const entryId = plan.days[0]?.entries[0]?.id ?? ''
  const session = async (reps: number) => {
    const s = expectContract(
      WorkoutSession,
      await send('/sessions', { workoutId: workout.id, dayId }),
    )
    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sets in order.
      await send(`/sessions/${s.id}/logs`, { exerciseId: lift.id, entryId, weightG: 55_000, reps })
    }
    return s.id
  }
  const earlier = await session(8)
  await send(`/sessions/${earlier}`, { endedAt: new Date().toISOString() }, 'PATCH')
  const later = await session(9)
  const logs = expectContract(
    WorkoutSession,
    await send(`/sessions/${earlier}`, undefined, 'GET'),
  ).logs.map((l) => l.id)
  return { workoutId: workout.id, earlier, later, logs }
}

describe("a person's steps, taken one write at a time", () => {
  test('a correction and a later finish at once leave the steps a run in order would', async () => {
    await Promise.all(Array.from({ length: 30 }, async () => await db.execute(sql`select 1`)))
    const wrong: number[] = []
    for (let round = 0; round < 12; round += 1) {
      // oxlint-disable-next-line no-await-in-loop -- rounds in turn: each is its own race.
      const p = await poised()
      // One set of the earlier session corrected to 7: it held at 8, so the later one's 9 met it,
      // and asks 9 — not 10, judged from the earlier's step before the correction gives.
      // oxlint-disable-next-line no-await-in-loop -- rounds in turn: each is its own race.
      await Promise.all([
        update(alice.caller, p.later, { endedAt: new Date().toISOString() }),
        amendLog(alice.caller, p.earlier, p.logs[0] ?? '', { reps: 7 }),
      ])
      // oxlint-disable-next-line no-await-in-loop -- rounds in turn: each is its own race.
      const [suggestion] = expectContract(
        z.array(ProgressionSuggestion),
        (await alice.wire(`/workouts/${p.workoutId}/progression`)).body,
      )
      if (suggestion?.suggested.reps !== 9) wrong.push(suggestion?.suggested.reps ?? -1)
    }
    expect(wrong).toEqual([])
  })
})
