import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type EquipmentSlug,
  Exercise,
  PLAN_WORDS,
  PlanSave,
  type Progression,
  Workout,
  WorkoutPlanInput,
} from '@cedo/contract'
import { coachedSquad } from '../test/coaching.ts'
import { expectContract } from '../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../test/harness.ts'
import { callTool, mintPat, post, publishedTool, textOf } from '../test/mcp-wire.ts'

/**
 * The progression model as a model meets it (#58, docs/07-mcp.md "A plan teaches its own model"):
 * a plan's outline says every rule in full, each set's reps in reserve and the caller's own target;
 * `workout_progression` says each hold by its set; `target_set` sets a target by hand; and a plan
 * written from the tool descriptions alone round-trips.
 */

let h: TestApi
let alice: TestUser
let pat: string

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  pat = await mintPat(alice)
})

const DOUBLE: Progression = { kind: 'double', repRange: [8, 12], incrementG: 2500 }
const LINEAR: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }

/** An exercise of `user`'s, measured as `tracking`, needing `equipment`. */
const exercise = async (
  user: TestUser,
  name: string,
  tracking = 'weight_reps',
  equipment: readonly EquipmentSlug[] | null = null,
) =>
  expectContract(
    Exercise,
    await post(user, '/exercises', {
      name,
      tracking,
      equipment,
      muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
    }),
  )

/**
 * A workout of one day, one entry of 3 × 8 at 60 kg asking 2 in reserve, under `rule` — of an
 * exercise needing `equipment`, if any.
 */
async function planned(
  user: TestUser,
  rule: Progression,
  equipment: readonly EquipmentSlug[] | null = null,
) {
  const bench = await exercise(user, 'Bench', 'weight_reps', equipment)
  const workout = expectContract(Workout, await post(user, '/workouts', { name: 'Push' }))
  const set = { targetReps: 8, targetWeightG: 60_000, targetReserve: 2 }
  const plan = expectContract(
    Workout,
    await post(
      user,
      `/workouts/${workout.id}/plan`,
      {
        days: [
          {
            name: 'A',
            entries: [{ exerciseId: bench.id, sets: [set, set, set], progression: rule }],
          },
        ],
      },
      'PUT',
    ),
  )
  const dayId = plan.days[0]?.id ?? ''
  const entryId = plan.days[0]?.entries[0]?.id ?? ''
  return { workoutId: workout.id, dayId, entryId, exerciseId: bench.id }
}

type Planned = Awaited<ReturnType<typeof planned>>

/** One session logged whole: a set of each `reps`, at 60 kg, each leaving `reserve`. */
async function trained(
  token: string,
  p: Planned,
  reps: readonly number[],
  reserve: number | null = 2,
) {
  await callTool(token, 'session_log', {
    workoutId: p.workoutId,
    dayId: p.dayId,
    sets: reps.map((r) => ({
      exerciseId: p.exerciseId,
      entryId: p.entryId,
      weightG: 60_000,
      reps: r,
      reserve,
    })),
  })
}

const progression = async (token: string, p: Planned) =>
  textOf((await callTool(token, 'workout_progression', { workoutId: p.workoutId })).body)

describe('workout_get says everything a rule depends on', () => {
  test('each rule in full, Manual included', async () => {
    const p = await planned(alice, DOUBLE)
    const press = await exercise(alice, 'Press')
    const plank = await exercise(alice, 'Plank', 'duration')
    const set = { targetReps: 5, targetWeightG: 40_000 }
    await callTool(pat, 'workout_save_plan', {
      workoutId: p.workoutId,
      days: [
        {
          name: 'A',
          entries: [
            {
              id: p.entryId,
              exerciseId: p.exerciseId,
              sets: [{ targetReps: 8, targetWeightG: 60_000 }],
              progression: DOUBLE,
            },
            { exerciseId: press.id, sets: [set], progression: { ...LINEAR, afterSuccesses: 2 } },
            {
              exerciseId: plank.id,
              sets: [{ targetDurationS: 60 }],
              progression: { kind: 'linear_duration', incrementS: 15 },
            },
            { exerciseId: press.id, sets: [set] },
          ],
        },
      ],
    })
    const outline = textOf((await callTool(pat, 'workout_get', { workoutId: p.workoutId })).body)
    expect(outline).toContain('progression: Double 8–12, +2.5 kg')
    expect(outline).toContain('progression: Linear, +2.5 kg after 2 cleared sessions')
    expect(outline).toContain('progression: Linear, +0:15')
    expect(outline).toContain('progression: Manual')
  })

  test('each set’s reps in reserve, a ramp as written', async () => {
    const p = await planned(alice, LINEAR)
    await callTool(pat, 'workout_save_plan', {
      workoutId: p.workoutId,
      days: [
        {
          name: 'A',
          entries: [
            {
              id: p.entryId,
              exerciseId: p.exerciseId,
              progression: LINEAR,
              sets: [2, 1, 0].map((targetReserve) => ({
                targetReps: 8,
                targetWeightG: 60_000,
                targetReserve,
              })),
            },
          ],
        },
      ],
    })
    const lines = textOf(
      (await callTool(pat, 'workout_get', { workoutId: p.workoutId })).body,
    ).split('\n')
    expect(lines.filter((l) => l.includes('work: 8 × 60 kg')).map((l) => l.trim())).toEqual([
      'work: 8 × 60 kg · 2 in reserve',
      'work: 8 × 60 kg · 1 in reserve',
      'work: 8 × 60 kg · 0 in reserve',
    ])
  })

  test("the caller's own target beside the prescription, only once it differs", async () => {
    const p = await planned(alice, DOUBLE)
    const before = textOf((await callTool(pat, 'workout_get', { workoutId: p.workoutId })).body)
    expect(before).not.toContain('next:')
    await trained(pat, p, [8, 8, 8])
    const after = textOf((await callTool(pat, 'workout_get', { workoutId: p.workoutId })).body)
    expect(after).toContain('      next: 9 × 60 kg — your target; reps in reserve as each set asks')
  })

  test("read for an athlete, it prints no target — not even the coach's own", async () => {
    const { coach, athlete } = await coachedSquad(h)
    const coachPat = await mintPat(coach)
    const p = await planned(coach, DOUBLE)
    await trained(coachPat, p, [8, 8, 8])
    const own = textOf((await callTool(coachPat, 'workout_get', { workoutId: p.workoutId })).body)
    expect(own).toContain('next:')
    const theirs = await callTool(coachPat, 'workout_get', {
      workoutId: p.workoutId,
      athlete: athlete.userId,
    })
    expect(textOf(theirs.body)).toContain('progression: Double 8–12')
    expect(textOf(theirs.body)).not.toContain('next:')
  })
})

describe('workout_progression says each step, and each hold by its set', () => {
  test('a target moved past the plan, beside what the plan says', async () => {
    const p = await planned(alice, LINEAR)
    await trained(pat, p, [8, 8, 8])
    expect(await progression(pat, p)).toBe(
      'Bench (Linear, +2.5 kg): next 8 × 62.5 kg; the plan says 8 × 60 kg  (from 1 session)',
    )
  })

  test('short of the targets: the set, what it did, of what it was asked', async () => {
    const p = await planned(alice, LINEAR)
    await trained(pat, p, [8, 8, 6])
    expect(await progression(pat, p)).toBe(
      'Bench (Linear, +2.5 kg): next 8 × 60 kg, as the plan says — held: set 3 did 6 of 8  (from 1 session)',
    )
  })

  test('ground out past its reserve: the set, what it left, and what it asked', async () => {
    const p = await planned(alice, LINEAR)
    await trained(pat, p, [8, 8, 8], 0)
    expect(await progression(pat, p)).toBe(
      'Bench (Linear, +2.5 kg): next 8 × 60 kg, as the plan says — held for effort: set 1 left 0 in reserve, asked 2  (from 1 session)',
    )
  })

  test('nothing trained yet: the plan’s numbers, and no history', async () => {
    const p = await planned(alice, DOUBLE)
    expect(await progression(pat, p)).toBe(
      'Bench (Double 8–12, +2.5 kg): next 8 × 60 kg, as the plan says  (no session yet)',
    )
  })

  /** #66: what stands behind a target — set by hand, not the sessions it counted before. */
  test('set by hand: says so, and the sessions since', async () => {
    const p = await planned(alice, DOUBLE)
    await callTool(pat, 'target_set', { workoutId: p.workoutId, entryId: p.entryId, reps: 10 })
    expect(await progression(pat, p)).toBe(
      'Bench (Double 8–12, +2.5 kg): next 10 × 60 kg; the plan says 8 × 60 kg  (set by hand)',
    )
    await trained(pat, p, [10, 10, 10])
    expect(await progression(pat, p)).toBe(
      'Bench (Double 8–12, +2.5 kg): next 11 × 60 kg; the plan says 8 × 60 kg  (set by hand, then 1 session)',
    )
  })

  /** #66: where the athlete's equipment stops a target, which it never said. */
  test('at the heaviest the athlete can load, says so', async () => {
    const p = await planned(alice, LINEAR, ['dumbbells'])
    await callTool(pat, 'equipment_set', {
      items: [{ slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: 60_000 } }],
    })
    expect(await progression(pat, p)).toBe(
      'Bench (Linear, +2.5 kg): next 8 × 60 kg (your heaviest), as the plan says  (no session yet)',
    )
  })

  test('a manual entry is the plan’s numbers, and nothing moves them', async () => {
    const p = await planned(alice, { kind: 'none' })
    await trained(pat, p, [8, 8, 8])
    expect(await progression(pat, p)).toBe(
      'Bench (Manual): 8 × 60 kg, the plan’s numbers — change the plan to change them',
    )
  })
})

describe('target_set', () => {
  const setTarget = async (token: string, p: Planned, target: object) =>
    await callTool(token, 'target_set', { workoutId: p.workoutId, entryId: p.entryId, ...target })

  test('sets the caller’s own target, where their next session starts', async () => {
    const p = await planned(alice, DOUBLE)
    const set = await setTarget(pat, p, { reps: 11 })
    expect(set.body.result?.isError).toBeFalsy()
    expect(textOf(set.body)).toContain('next 11 × 60 kg;')
    expect(await progression(pat, p)).toContain('next 11 × 60 kg;')
  })

  test('refuses what the rule does not move, saying what to do instead', async () => {
    const p = await planned(alice, DOUBLE)
    const outside = await setTarget(pat, p, { reps: 14 })
    expect(outside.body.result?.isError).toBe(true)
    expect(textOf(outside.body)).toContain(
      'Double 8–12 asks 8 to 12 reps, not 14: set reps inside it, or change the plan’s range',
    )
    const manual = await setTarget(pat, await planned(alice, { kind: 'none' }), { reps: 10 })
    expect(textOf(manual.body)).toContain('A manual entry has no target')
  })

  test('only ever the caller’s own: another’s entry is not found', async () => {
    const p = await planned(alice, DOUBLE)
    const bob = await h.as('bob')
    const res = await setTarget(await mintPat(bob), p, { reps: 10 })
    expect(res.body.result?.isError).toBe(true)
    expect(await progression(pat, p)).toContain('next 8 × 60 kg')
  })

  test('is published as a write, its fields described', async () => {
    const tool = await publishedTool(pat, 'target_set')
    expect(tool?.annotations?.['readOnlyHint']).toBe(false)
    expect(JSON.stringify(tool?.inputSchema)).toContain('Weight in GRAMS')
  })
})

describe('a plan written from the tool descriptions alone', () => {
  test('workout_save_plan publishes every description the plan carries', async () => {
    const tool = await publishedTool(pat, 'workout_save_plan')
    const published = JSON.stringify(tool?.inputSchema)
    const missing = Object.entries(PLAN_WORDS).filter(
      ([, words]) => !published.includes(JSON.stringify(words).slice(1, -1)),
    )
    expect(missing.map(([field]) => field)).toEqual([])
  })

  /**
   * What a model following only the published descriptions writes: warm-ups as their own sets with
   * numbers, a ramp of reps in reserve, a double range around the reps — and no RPE anywhere.
   */
  test('round-trips through workout_get_editable as it was written', async () => {
    const bench = await exercise(alice, 'Bench')
    const workout = expectContract(Workout, await post(alice, '/workouts', { name: 'Push' }))
    // Only what the descriptions ask for: every default left to the plan.
    const warmup = (targetReps: number, targetWeightG: number) => ({
      targetReps,
      targetWeightG,
      isWarmup: true,
    })
    const written = {
      days: [
        {
          name: 'Push',
          entries: [
            {
              exerciseId: bench.id,
              restSeconds: 180,
              cue: 'Leave 2 in reserve on the first set',
              progression: DOUBLE,
              sets: [
                warmup(5, 40_000),
                warmup(3, 50_000),
                ...[2, 1, 0].map((targetReserve) => ({
                  targetReps: 8,
                  targetWeightG: 60_000,
                  targetReserve,
                })),
              ],
            },
          ],
        },
      ],
    }
    const saved = await callTool(pat, 'workout_save_plan', { workoutId: workout.id, ...written })
    expect(saved.body.result?.isError).toBeFalsy()
    const editableText = textOf(
      (await callTool(pat, 'workout_get_editable', { workoutId: workout.id })).body,
    )
    const { version: _version, ...plan } = PlanSave.parse(JSON.parse(editableText))
    const withoutIds = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value, (k, v: unknown) => (k === 'id' ? undefined : v)))
    expect(withoutIds(plan)).toEqual(withoutIds(WorkoutPlanInput.parse(written)))
    expect(editableText).not.toMatch(/rpe/iu)
    const outline = textOf((await callTool(pat, 'workout_get', { workoutId: workout.id })).body)
    expect(outline).toContain('warm-up: 5 × 40 kg')
    expect(outline).not.toMatch(/RPE/u)
  })

  test('every state the contract refuses is refused with what to do instead', async () => {
    const workout = expectContract(Workout, await post(alice, '/workouts', { name: 'Push' }))
    const bench = await exercise(alice, 'Bench')
    const plank = await exercise(alice, 'Plank', 'duration')
    const save = async (entry: object) =>
      textOf(
        (
          await callTool(pat, 'workout_save_plan', {
            workoutId: workout.id,
            days: [{ name: 'A', entries: [entry] }],
          })
        ).body,
      )
    const at = (targetReps: number, targetWeightG = 60_000) => ({ targetReps, targetWeightG })

    expect(await save({ exerciseId: bench.id, progression: DOUBLE, sets: [at(4)] })).toContain(
      'set the reps inside the range, or change it',
    )
    expect(
      await save({
        exerciseId: bench.id,
        progression: { ...DOUBLE, repRange: [12, 8] },
        sets: [at(10)],
      }),
    ).toContain('A double range runs from fewer reps to more: 8 to 12, not 12 to 8')
    expect(
      await save({
        exerciseId: bench.id,
        progression: { ...DOUBLE, repRange: [10, 10] },
        sets: [at(10)],
      }),
    ).toContain('for one rep count, use linear')
    expect(
      await save({
        exerciseId: bench.id,
        progression: LINEAR,
        sets: [at(6, 90_000), at(8, 80_000)],
      }),
    ).toContain('use Manual')
    expect(
      await save({ exerciseId: plank.id, progression: DOUBLE, sets: [{ targetDurationS: 60 }] }),
    ).toContain('not double')
    expect(
      await save({ exerciseId: bench.id, sets: [{ targetReps: 8, targetReserve: 1.5 }] }),
    ).toContain('a range such as 1–2 is asked as its bottom')
    const retracked = await callTool(pat, 'exercise_update', {
      exerciseId: bench.id,
      tracking: 'duration',
    })
    expect(textOf(retracked.body)).toContain('duplicate it to track it differently')
  })
})
