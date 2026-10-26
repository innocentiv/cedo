import { describe, expect, test } from 'bun:test'
import type { SetTarget } from './progression.ts'
import { restAlertOf } from './rest-alert.ts'

const target = (reps: number, kg: number): SetTarget => ({
  reps,
  weightG: kg * 1000,
  rpe: null,
  durationS: null,
  distanceMm: null,
})

const squat = {
  id: 'squat',
  index: 0,
  supersetGroup: null,
  exercise: { name: 'Barbell Back Squat', tracking: 'weight_reps' as const },
  sets: [0, 1, 2, 3, 4].map((index) => ({ index, isWarmup: false, target: target(5, 100) })),
}

const logged = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `log-${String(i)}`,
    entryId: 'squat',
    isWarmup: false,
    loggedAt: new Date(Date.parse('2026-10-26T18:00:00Z') + i * 60_000).toISOString(),
    reps: 5,
    weightG: 100_000,
    durationS: null,
    distanceMm: null,
  }))

/** What a rest alert says (#38): the next set, as the logger would ask it. */
describe('a rest alert', () => {
  test('names the next set, at the target the session asks', () => {
    const alert = restAlertOf(
      { entries: [squat] },
      logged(2),
      [{ entryId: 'squat', target: target(5, 102.5) }],
      'kg',
    )
    expect(alert).toEqual({
      title: 'Rest over',
      body: 'Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg',
    })
  })

  test('in the athlete’s unit', () => {
    expect(restAlertOf({ entries: [squat] }, logged(1), [], 'lb').body).toBe(
      'Barbell Back Squat — Set 2 of 5: 5 × 220.46 lb',
    )
  })

  test('without a plan to say what is next, only that the rest is over', () => {
    expect(restAlertOf(null, logged(1), [], 'kg')).toEqual({
      title: 'Rest over',
      body: 'Time for the next set.',
    })
  })
})
