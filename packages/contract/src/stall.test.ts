import { describe, expect, test } from 'bun:test'
import { AT_LEAST_SESSIONS, STALL_DEPTH, formatStall, stallOf } from './stall.ts'

const lift = (reps: number, weightKg: number) => ({
  reps,
  weightG: weightKg * 1000,
  durationS: null,
  distanceMm: null,
})

/** Stalled (GLOSSARY.md): the latest sessions, three or more running, share one top set. */
describe('a stall', () => {
  test(`is ${AT_LEAST_SESSIONS} or more sessions running at one top set, newest first`, () => {
    const sessions = [[lift(5, 60), lift(8, 50)], [lift(5, 60)], [lift(5, 60)], [lift(5, 55)]]
    expect(stallOf(sessions, 'weight_reps')).toEqual({ sessions: 3, effort: lift(5, 60) })
  })

  test('is none while the top set moves, or before enough sessions', () => {
    expect(stallOf([[lift(6, 60)], [lift(5, 60)], [lift(5, 60)]], 'weight_reps')).toBeNull()
    expect(stallOf([[lift(5, 60)], [lift(5, 60)]], 'weight_reps')).toBeNull()
  })

  /** What a reader judges over is capped, so the run reported is too — at the same depth for all. */
  test(`counts at most the latest ${STALL_DEPTH} sessions`, () => {
    const sessions = Array.from({ length: STALL_DEPTH + 4 }, () => [lift(5, 60)])
    expect(stallOf(sessions, 'weight_reps')?.sessions).toBe(STALL_DEPTH)
  })

  test('says what it is stuck at, as its mode measures it', () => {
    const stall = { sessions: 4, effort: lift(5, 60) }
    expect(formatStall(stall, 'weight_reps', 'kg')).toBe('4 sessions at 5 × 60 kg')
  })
})
