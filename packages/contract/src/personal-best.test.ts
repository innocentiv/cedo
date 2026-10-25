import { describe, expect, test } from 'bun:test'
import type { Effort } from './effort.ts'
import { type LoggedWork, isPersonalBest, personalBestsIn } from './personal-best.ts'

/** Personal bests (GLOSSARY.md), as the workout screen and a session's summary mark them (#24). */

const lift = (
  reps: number,
  kg: number,
  rpe: number | null = null,
): Effort & { rpe: number | null } => ({
  reps,
  weightG: kg * 1000,
  durationS: null,
  distanceMm: null,
  rpe,
})

describe('a weight lift, by estimated max from what was lifted', () => {
  test('more estimated max is a best, even at fewer reps', () => {
    // 3 × 110 kg estimates 121 kg; 5 × 100 kg, 116.5 kg.
    expect(isPersonalBest(lift(3, 110), [lift(5, 100)], 'weight_reps')).toBe(true)
  })

  test('the same estimate, or less, is not', () => {
    expect(isPersonalBest(lift(5, 100), [lift(5, 100)], 'weight_reps')).toBe(false)
    expect(isPersonalBest(lift(8, 90), [lift(5, 100)], 'weight_reps')).toBe(false)
  })

  test('the reserve a set was rated with plays no part', () => {
    // Rated 8 — two in reserve — it would estimate as seven reps, over the earlier 5 × 100.
    expect(isPersonalBest(lift(5, 100, 8), [lift(5, 100)], 'weight_reps')).toBe(false)
  })

  test('a set beyond the estimate’s range neither makes a best nor blocks one', () => {
    expect(isPersonalBest(lift(15, 120), [lift(5, 100)], 'weight_reps')).toBe(false)
    expect(isPersonalBest(lift(5, 105), [lift(15, 120), lift(5, 100)], 'weight_reps')).toBe(true)
  })
})

describe('the other modes, as their top set is ranked', () => {
  const bw = (reps: number, kg: number | null = null): Effort => ({
    reps,
    weightG: kg === null ? null : kg * 1000,
    durationS: null,
    distanceMm: null,
  })
  const held = (s: number): Effort => ({
    reps: null,
    weightG: null,
    durationS: s,
    distanceMm: null,
  })
  const ran = (m: number, s: number): Effort => ({
    reps: null,
    weightG: null,
    durationS: s,
    distanceMm: m * 1000,
  })

  test('a bodyweight movement: weight added first, then reps', () => {
    expect(isPersonalBest(bw(12), [bw(10)], 'bodyweight_reps')).toBe(true)
    expect(isPersonalBest(bw(3, 5), [bw(15)], 'bodyweight_reps')).toBe(true)
    expect(isPersonalBest(bw(15), [bw(3, 5)], 'bodyweight_reps')).toBe(false)
  })

  test('a hold, by time', () => {
    expect(isPersonalBest(held(75), [held(60)], 'duration')).toBe(true)
    expect(isPersonalBest(held(60), [held(60)], 'duration')).toBe(false)
  })

  test('distance over time: further, or the same distance faster', () => {
    expect(isPersonalBest(ran(5500, 2000), [ran(5000, 1500)], 'distance_duration')).toBe(true)
    expect(isPersonalBest(ran(5000, 1450), [ran(5000, 1500)], 'distance_duration')).toBe(true)
    expect(isPersonalBest(ran(5000, 1550), [ran(5000, 1500)], 'distance_duration')).toBe(false)
  })
})

test('a first time is not a best: there is nothing to beat', () => {
  expect(isPersonalBest(lift(5, 100), [], 'weight_reps')).toBe(false)
})

describe("a session's personal bests", () => {
  const set = (exerciseId: string, reps: number, kg: number, isWarmup = false): LoggedWork => ({
    id: crypto.randomUUID(),
    exerciseId,
    isWarmup,
    ...lift(reps, kg),
  })

  test('each set against earlier sessions and the sets before it in this one', () => {
    const logs = [set('squat', 5, 105), set('squat', 5, 107.5), set('squat', 5, 107.5)]
    const bests = personalBestsIn(logs, new Map([['squat', [lift(5, 100)]]]), () => 'weight_reps')
    expect(logs.map((l) => bests.has(l.id))).toEqual([true, true, false])
  })

  test('never a warm-up, nor an exercise the reader cannot see', () => {
    const logs = [set('squat', 5, 140, true), set('hidden', 5, 200)]
    const bests = personalBestsIn(
      logs,
      new Map([
        ['squat', [lift(5, 100)]],
        ['hidden', [lift(5, 100)]],
      ]),
      (id) => (id === 'hidden' ? null : 'weight_reps'),
    )
    expect(bests.size).toBe(0)
  })
})
