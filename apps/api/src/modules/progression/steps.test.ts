import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  ApiError,
  EntryTarget,
  Exercise,
  SessionEntryTarget,
  Workout,
  WorkoutSession,
} from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestUser, makeApi } from '../../test/harness.ts'
import { callTool, mintPat } from '../../test/mcp-wire.ts'

/**
 * A person's target, stored as steps (ADR-0026): the rule runs once, when a session is finished,
 * against the target — not on every read against the plan. Driven through the routes.
 */

let alice: TestUser

beforeEach(async () => {
  alice = await (await makeApi()).as('alice')
})

const send = async (path: string, body: unknown, method = 'POST') => {
  const res = await alice.wire(path, { method, body: JSON.stringify(body) })
  if (res.status >= 300)
    throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body
}

const DOUBLE = { kind: 'double', repRange: [8, 12], incrementG: 2500 }

/** A lat pulldown planned at `reps` × 55 kg for three working sets, double 8–12, +2.5 kg. */
async function planned(reps = 8, progression: unknown = DOUBLE) {
  const pulldown = expectContract(
    Exercise,
    await send('/exercises', {
      name: 'Lat Pulldown',
      muscles: [{ muscle: 'latissimus_dorsi', loadPct: 100 }],
    }),
  )
  const workout = expectContract(Workout, await send('/workouts', { name: 'Upper' }))
  const set = { targetReps: reps, targetWeightG: 55_000 }
  const plan = expectContract(
    Workout,
    await send(
      `/workouts/${workout.id}/plan`,
      {
        days: [
          {
            name: 'Mon',
            entries: [{ exerciseId: pulldown.id, sets: [set, set, set], progression }],
          },
        ],
      },
      'PUT',
    ),
  )
  const day = plan.days[0]
  const entry = day?.entries[0]
  if (day === undefined || entry === undefined) throw new Error('no plan')
  return { workoutId: workout.id, dayId: day.id, entryId: entry.id, exerciseId: pulldown.id }
}

type Plan = Awaited<ReturnType<typeof planned>>

const start = async (p: Plan) =>
  expectContract(
    WorkoutSession,
    await send('/sessions', { workoutId: p.workoutId, dayId: p.dayId }),
  ).id

/** One working set of the entry: `reps` at `weightG`. */
const setOf = (p: Plan, reps: number, weightG = 55_000) => ({
  exerciseId: p.exerciseId,
  entryId: p.entryId,
  weightG,
  reps,
})

/** A session in progress, three working sets of `reps` at `weightG` logged. */
async function logged(p: Plan, reps: number, weightG = 55_000): Promise<string> {
  const id = await start(p)
  for (let i = 0; i < 3; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- sets in order, as they are logged.
    await send(`/sessions/${id}/logs`, setOf(p, reps, weightG))
  }
  return id
}

const finish = async (id: string) =>
  await send(`/sessions/${id}`, { endedAt: new Date().toISOString() }, 'PATCH')

/** A finished session of three working sets of `reps` at `weightG`. */
async function trained(p: Plan, reps: number, weightG = 55_000): Promise<string> {
  const id = await logged(p, reps, weightG)
  await finish(id)
  return id
}

/** What the next session asks, through the logger's own read — that session left in progress. */
const asked = async (p: Plan) => {
  const id = await start(p)
  const [target] = expectContract(
    z.array(SessionEntryTarget),
    (await alice.wire(`/sessions/${id}/targets`)).body,
  )
  return target
}

/** What `workout_progression` reads, through its route. */
const shown = async (p: Plan) => {
  const [target] = expectContract(
    z.array(EntryTarget),
    (await alice.wire(`/workouts/${p.workoutId}/progression`)).body,
  )
  return target
}

/** The caller's own target on the entry, set by hand. */
const setBy = (p: Plan, target: unknown) =>
  alice.wire(`/workouts/${p.workoutId}/entries/${p.entryId}/target`, {
    method: 'PUT',
    body: JSON.stringify(target),
  })

describe('a target accumulates across finished sessions', () => {
  /**
   * The bug ADR-0026 began with: judged against the plan's own 8 every time, the target moved one
   * step past the plan and stayed — 8, then 9, then 9, then 9 — until someone rewrote the plan.
   */
  test('double climbs a rep for every session that met it, past the plan', async () => {
    const p = await planned()
    for (const reps of [8, 9, 10]) {
      // oxlint-disable-next-line no-await-in-loop -- sessions in order: what is under test.
      await trained(p, reps)
    }
    expect((await shown(p))?.target).toMatchObject({ reps: 11, weightG: 55_000 })
    const target = await asked(p)
    expect(target?.prescribed).toMatchObject({ reps: 8, weightG: 55_000 })
    expect(target?.target).toMatchObject({ reps: 11, weightG: 55_000 })
  })
})

/** The plan saved again with its ids, so the entry keeps its steps (docs/06-api.md). */
async function replanned(p: Plan, weightG: number, progression: unknown = DOUBLE): Promise<void> {
  const set = { targetReps: 8, targetWeightG: weightG }
  await send(
    `/workouts/${p.workoutId}/plan`,
    {
      days: [
        {
          id: p.dayId,
          name: 'Mon',
          entries: [
            { id: p.entryId, exerciseId: p.exerciseId, sets: [set, set, set], progression },
          ],
        },
      ],
    },
    'PUT',
  )
}

/** Resets are derived, never written (ADR-0026): an edit leaves every step where it is. */
describe('a plan edit restarts a target — reversibly', () => {
  test('a typo fixed before anyone trains loses nothing', async () => {
    const p = await planned()
    await trained(p, 8)
    expect((await shown(p))?.target).toMatchObject({ reps: 9, weightG: 55_000 })
    await replanned(p, 5_500)
    expect((await shown(p))?.target).toMatchObject({ reps: 8, weightG: 5_500 })
    await replanned(p, 55_000)
    expect((await shown(p))?.target).toMatchObject({ reps: 9, weightG: 55_000 })
  })

  test('an edit trained against starts the target again from the new plan, for good', async () => {
    const p = await planned()
    await trained(p, 8)
    await replanned(p, 60_000)
    await trained(p, 8, 60_000)
    expect((await shown(p))?.target).toMatchObject({ reps: 9, weightG: 60_000 })
    await replanned(p, 55_000)
    expect((await shown(p))?.target).toMatchObject({ reps: 8, weightG: 55_000 })
  })

  test('another working set added keeps the target', async () => {
    const p = await planned()
    await trained(p, 8)
    const set = { targetReps: 8, targetWeightG: 55_000 }
    await send(
      `/workouts/${p.workoutId}/plan`,
      {
        days: [
          {
            id: p.dayId,
            name: 'Mon',
            entries: [
              {
                id: p.entryId,
                exerciseId: p.exerciseId,
                sets: [set, set, set, set],
                progression: DOUBLE,
              },
            ],
          },
        ],
      },
      'PUT',
    )
    expect((await shown(p))?.target).toMatchObject({ reps: 9, weightG: 55_000 })
  })
})

/**
 * Any change to a session takes again the steps of what it trained — finished before it, or by it
 * — and every step after it, in the transaction that makes it (ADR-0026): each leaves the target
 * where the same sessions, done in order, would. One table, one row a change.
 */
describe('a change to a session moves the steps it trained, and every one after', () => {
  const setsOf = async (sessionId: string) =>
    expectContract(WorkoutSession, (await alice.wire(`/sessions/${sessionId}`)).body).logs.map(
      (l) => l.id,
    )
  /** An earlier session at 8 met the target, a later one at 9 the next: the target asks 10. */
  const twoSessions = async (p: Plan) => {
    const first = await trained(p, 8)
    await trained(p, 9)
    expect((await shown(p))?.target.reps).toBe(10)
    return first
  }
  /** Each change, and the target it leaves: 9 — the 8s met once — throughout. */
  const changes: readonly (readonly [string, (p: Plan) => Promise<void>])[] = [
    [
      'finished: its own steps, none while it was in progress',
      async (p) => {
        const id = await logged(p, 8)
        expect((await shown(p))?.target.reps).toBe(8)
        await finish(id)
      },
    ],
    [
      // `session_log`, through MCP: a whole session from the AI.
      'logged whole: its steps, as a finish takes them',
      async (p) => {
        const set = setOf(p, 8)
        const sent = await callTool(await mintPat(alice), 'session_log', {
          workoutId: p.workoutId,
          dayId: p.dayId,
          sets: [set, set, set],
        })
        expect(sent.body.result?.isError ?? false).toBe(false)
      },
    ],
    [
      // 8 typed for 7: the earlier session did not meet 8, so the later one met it.
      'an earlier session’s sets corrected: every step since',
      async (p) => {
        const first = await twoSessions(p)
        for (const id of await setsOf(first)) {
          // oxlint-disable-next-line no-await-in-loop -- one set after another.
          await send(`/sessions/${first}/logs/${id}`, { reps: 7 }, 'PATCH')
        }
      },
    ],
    [
      // Two sets of three: short of the target, so the later session is what met it.
      'a set of an earlier session removed: every step since',
      async (p) => {
        const first = await twoSessions(p)
        const [one] = await setsOf(first)
        await send(`/sessions/${first}/logs/${one ?? ''}`, {}, 'DELETE')
      },
    ],
    [
      'an earlier session deleted: every step since',
      async (p) => {
        await send(`/sessions/${await twoSessions(p)}`, {}, 'DELETE')
        expect((await shown(p))?.sessions).toBe(1)
      },
    ],
  ]

  test.each(changes)('%s', async (_, change) => {
    const p = await planned()
    await change(p)
    expect((await shown(p))?.target.reps).toBe(9)
  })
})

/** A target set by hand anchors what follows (ADR-0026): a step of its own, by the same rules. */
describe('a target set by hand', () => {
  test('is where the next session is judged from', async () => {
    const p = await planned()
    await trained(p, 8)
    const set = await setBy(p, { reps: 11 })
    expect(expectContract(EntryTarget, set.body).target).toMatchObject({
      reps: 11,
      weightG: 55_000,
    })
    await trained(p, 11)
    expect((await shown(p))?.target).toMatchObject({ reps: 12, weightG: 55_000 })
  })

  test('is refused for what the rule does not move, saying why — and nothing is set', async () => {
    const p = await planned()
    const res = await setBy(p, { reps: 14 })
    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body)).toContain(
      'Double 8–12 asks 8 to 12 reps, not 14: set reps inside it',
    )
    expect((await shown(p))?.target).toMatchObject({ reps: 8, weightG: 55_000 })
  })

  test('is set only on an entry of the workout it names', async () => {
    const p = await planned()
    const other = await planned()
    const res = await alice.wire(`/workouts/${other.workoutId}/entries/${p.entryId}/target`, {
      method: 'PUT',
      body: JSON.stringify({ reps: 10 }),
    })
    expect(res.status).toBe(404)
    expectContract(ApiError, res.body)
    expect((await shown(p))?.target.reps).toBe(8)
  })

  test('is not anyone else’s to set', async () => {
    const p = await planned()
    const bob = await (await makeApi()).as('bob')
    const res = await bob.wire(`/workouts/${p.workoutId}/entries/${p.entryId}/target`, {
      method: 'PUT',
      body: JSON.stringify({ reps: 10 }),
    })
    expect(res.status).toBe(404)
  })
})

/**
 * The sessions behind a target (#66): the run since it last started — from the plan's
 * prescription, or set by hand — never every session the entry ever took. What
 * `workout_progression` says as "from 3 sessions"; worked out in SQL (`latestSteps`).
 */
describe('the sessions behind a target', () => {
  test('each session of the run, every one building on the last', async () => {
    const p = await planned()
    await trained(p, 8)
    await trained(p, 9)
    expect(await shown(p)).toMatchObject({ sessions: 2, byHand: false })
  })

  test('none once a plan edit restarts it — and the run again once the plan is put back', async () => {
    const p = await planned()
    await trained(p, 8)
    await trained(p, 9)
    await replanned(p, 60_000)
    expect(await shown(p)).toMatchObject({ sessions: 0, byHand: false })
    await replanned(p, 55_000)
    expect(await shown(p)).toMatchObject({ sessions: 2 })
  })

  test('a plan moved away and back counts from its return, where the target restarted', async () => {
    const p = await planned()
    await trained(p, 8)
    await replanned(p, 60_000)
    await trained(p, 8, 60_000)
    await replanned(p, 55_000)
    await trained(p, 8)
    // Judged from 55 kg's prescription again: the step at 60 kg did not count against it.
    expect(await shown(p)).toMatchObject({ target: { reps: 9 }, sessions: 1 })
  })

  test('set by hand: says so, and counts the sessions since', async () => {
    const p = await planned()
    await trained(p, 8)
    await setBy(p, { reps: 11 })
    expect(await shown(p)).toMatchObject({ sessions: 0, byHand: true })
    await trained(p, 11)
    expect(await shown(p)).toMatchObject({ target: { reps: 12 }, sessions: 1, byHand: true })
  })
})
