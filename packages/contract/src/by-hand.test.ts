import { describe, expect, test } from 'bun:test'
import { targetByHand } from './by-hand.ts'
import type { Progression, SetTarget } from './progression.ts'

/**
 * A target set by hand (ADR-0026): a person puts themselves where they are — but a target differs
 * from its prescription only in what the rule moves. Anything else is a plan edit.
 */
const plan: SetTarget = { reps: 8, weightG: 55_000, reserve: 2, durationS: null, distanceMm: null }
const DOUBLE: Progression = { kind: 'double', repRange: [8, 12], incrementG: 2500 }
const LINEAR: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }

describe('a target set by hand', () => {
  test('under double: reps inside the range, and weight', () => {
    expect(targetByHand(DOUBLE, plan, { reps: 10, weightG: 57_500 })).toEqual({
      target: { ...plan, reps: 10, weightG: 57_500 },
    })
  })

  test('under double, reps outside the range are refused, saying the range and what to do', () => {
    expect(targetByHand(DOUBLE, plan, { reps: 14 })).toEqual({
      refused:
        'Double 8–12 asks 8 to 12 reps, not 14: set reps inside it, or change the plan’s range',
    })
  })

  test('under double, anything but reps and weight is refused, saying what to do', () => {
    expect(targetByHand(DOUBLE, plan, { durationS: 30 })).toEqual({
      refused: 'Double moves only reps and weight: change the plan for anything else',
    })
  })

  test('under linear: the weight, and not the reps, which it never moves', () => {
    expect(targetByHand(LINEAR, plan, { weightG: 60_000 })).toEqual({
      target: { ...plan, weightG: 60_000 },
    })
    expect(targetByHand(LINEAR, plan, { reps: 10 })).toEqual({
      refused: 'Linear moves only the weight: change the plan to ask other reps',
    })
  })

  test('a timed rule: the seconds', () => {
    const held: SetTarget = { ...plan, reps: null, weightG: null, durationS: 30 }
    const rule: Progression = { kind: 'linear_duration', incrementS: 5, afterSuccesses: 1 }
    expect(targetByHand(rule, held, { durationS: 45 })).toEqual({
      target: { ...held, durationS: 45 },
    })
  })

  test('a distance rule: further, its time following at the plan’s pace', () => {
    const run: SetTarget = {
      ...plan,
      reps: null,
      weightG: null,
      distanceMm: 5_000_000,
      durationS: 1800,
    }
    const rule: Progression = { kind: 'linear_distance', incrementMm: 500_000, afterSuccesses: 1 }
    expect(targetByHand(rule, run, { distanceMm: 6_000_000 })).toEqual({
      target: { ...run, distanceMm: 6_000_000, durationS: 2160 },
    })
    expect(targetByHand(rule, run, { durationS: 1500 })).toEqual({
      refused:
        'Distance moves only the distance, its time at the plan’s pace: change the plan to ask another pace',
    })
  })

  test('a manual entry has no target to set', () => {
    expect(targetByHand({ kind: 'none' }, plan, { weightG: 60_000 })).toEqual({
      refused: 'A manual entry has no target: its numbers are the plan’s, so change the plan',
    })
  })
})
