import { describe, expect, test } from 'bun:test'
import type { Load } from './load.ts'
import { loadableTarget, nextLoadableTarget } from './loadable-target.ts'
import type { SetTarget } from './progression.ts'

const dumbbells: Load = { stepG: 2000, minG: 2000, maxG: 30_000, assisted: false, unit: 'kg' }
const plan = (weightG: number | null): SetTarget => ({
  reps: 8,
  weightG,
  reserve: null,
  durationS: null,
  distanceMm: null,
})
const linear = { kind: 'linear' as const, incrementG: 2500, afterSuccesses: 1 }
const sessionAt = (weightG: number, reserve: number | null = null) => [
  Array.from({ length: 3 }, () => ({ weightG, reps: 8, reserve })),
]

describe('a prescription as it can be loaded', () => {
  test('22.5 kg on 2 kg dumbbells is 22; no weight, or no load known, is left alone', () => {
    expect(loadableTarget(dumbbells, plan(22_500)).target.weightG).toBe(22_000)
    expect(loadableTarget(dumbbells, plan(null)).target.weightG).toBeNull()
    expect(loadableTarget(null, plan(22_500)).target.weightG).toBe(22_500)
  })
})

describe('progression, against what can be loaded', () => {
  test('22 kg logged on a 22.5 kg plan meets it, and the next is a weight that can be loaded', () => {
    const next = nextLoadableTarget(
      { rule: linear, target: plan(22_500), workingSets: 3, sessions: sessionAt(22_000) },
      dumbbells,
    )
    expect(next.shown.weightG).toBe(22_000)
    // 22 + 2.5 is 24.5, which no dumbbell weighs: the heaviest not above it.
    expect(next.target.weightG).toBe(24_000)
    expect(next.limit).toBeNull()
  })

  test('with no load known, 22 kg on a 22.5 kg plan is still short, as it always was', () => {
    const next = nextLoadableTarget(
      { rule: linear, target: plan(22_500), workingSets: 3, sessions: sessionAt(22_000) },
      null,
    )
    expect(next.target.weightG).toBe(22_500)
    expect(next.held).toMatchObject({ reason: 'targets', set: 1 })
  })

  test('why it held is told as the rule told it (#45)', () => {
    const ground = sessionAt(22_000, 0)
    const next = nextLoadableTarget(
      { rule: linear, target: { ...plan(22_500), reserve: 2 }, workingSets: 3, sessions: ground },
      dumbbells,
    )
    expect(next.target.weightG).toBe(22_000)
    expect(next.held).toEqual({ reason: 'effort', set: 1, reserve: 0, asked: 2 })
    expect(
      nextLoadableTarget(
        { rule: linear, target: plan(22_500), workingSets: 3, sessions: sessionAt(22_000) },
        dumbbells,
      ).held,
    ).toBeNull()
  })

  test('at the heaviest dumbbell, progression stops there and says so', () => {
    const next = nextLoadableTarget(
      { rule: linear, target: plan(30_000), workingSets: 3, sessions: sessionAt(30_000) },
      dumbbells,
    )
    expect(next.target.weightG).toBe(30_000)
    expect(next.limit).toBe('heaviest')
  })

  test('held at a plan heavier than the heaviest dumbbell, it says so too', () => {
    const next = nextLoadableTarget(
      { rule: linear, target: plan(32_500), workingSets: 3, sessions: [] },
      dumbbells,
    )
    expect(next.target.weightG).toBe(30_000)
    expect(next.limit).toBe('heaviest')
  })

  test('double progression climbs a rep at the weight shown', () => {
    const next = nextLoadableTarget(
      {
        rule: { kind: 'double', repRange: [8, 12], incrementG: 2500 },
        target: plan(22_500),
        workingSets: 3,
        sessions: sessionAt(22_000),
      },
      dumbbells,
    )
    expect(next.target).toMatchObject({ reps: 9, weightG: 22_000 })
    expect(next.limit).toBeNull()
  })

  test('an increase under one step still moves one weight up — never held there for good', () => {
    const next = nextLoadableTarget(
      {
        rule: { ...linear, incrementG: 1000 },
        target: plan(20_000),
        workingSets: 3,
        sessions: sessionAt(20_000),
      },
      dumbbells,
    )
    expect(next.target.weightG).toBe(22_000)
  })

  test('double progression at the top of its reps moves one weight up, not round its reps again', () => {
    const next = nextLoadableTarget(
      {
        rule: { kind: 'double', repRange: [8, 12], incrementG: 1000 },
        target: { ...plan(22_000), reps: 12 },
        workingSets: 3,
        sessions: [Array.from({ length: 3 }, () => ({ weightG: 22_000, reps: 12 }))],
      },
      dumbbells,
    )
    expect(next.target).toMatchObject({ reps: 8, weightG: 24_000 })
  })
})
