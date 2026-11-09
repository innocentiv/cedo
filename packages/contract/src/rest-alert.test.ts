import { describe, expect, test } from 'bun:test'
import type { SessionEntryTarget } from './entry-target.ts'
import { loggerAsks } from './focus-logger.ts'
import type { SetTarget } from './progression.ts'
import { type FlowLog, adHocSetsOf, setsOf } from './session-flow.ts'
import { restAlertOf } from './rest-alert.ts'

/** What a rest's end says with the app closed (#39): the set the logger will ask next, as it asks it. */

const at = (reps: number, kg: number): SetTarget => ({
  reps,
  weightG: kg * 1000,
  reserve: null,
  durationS: null,
  distanceMm: null,
})

const squat = {
  id: 'squat',
  index: 0,
  exerciseId: 'back-squat',
  supersetGroup: null,
  exercise: { name: 'Barbell Back Squat', tracking: 'weight_reps' as const },
  sets: [0, 1, 2, 3, 4].map((index) => ({ index, isWarmup: false, target: at(5, 100) })),
}

/** This session asks more than the plan: progression moved the target to 102.5 kg. */
const asked: SessionEntryTarget = {
  entryId: 'squat',
  exerciseId: 'back-squat',
  exerciseName: 'Barbell Back Squat',
  tracking: 'weight_reps',
  rule: { kind: 'none' },
  prescribed: at(5, 100),
  target: at(5, 102.5),
  changed: true,
  held: null,
  limit: null,
  sessions: 0,
  byHand: false,
  warmups: [],
  working: Array.from({ length: 5 }, () => at(5, 102.5)),
  last: null,
}

type Log = FlowLog & { readonly exerciseId: string }
const logged = (n: number, entryId: string | null = 'squat'): Log[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `log-${String(i)}`,
    entryId,
    exerciseId: entryId === null ? 'curl' : 'back-squat',
    isWarmup: false,
    loggedAt: new Date(Date.parse('2026-10-26T18:00:00Z') + i * 60_000).toISOString(),
    reps: 8,
    weightG: 20_000,
    durationS: null,
    distanceMm: null,
  }))

/** The squat in focus, as `workoutView` gives it. */
const onSquat = (logs: readonly Log[]) => ({
  kind: 'entry' as const,
  entry: squat,
  sets: setsOf(squat, logs, asked),
  asked,
  undone: null,
})

describe('what a rest’s end says', () => {
  test('names the next set, at the target the session asks', () => {
    expect(restAlertOf(onSquat(logged(2)), 'kg')).toEqual({
      title: 'Rest over',
      body: 'Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg',
    })
  })

  /** The same set, in the same words and numbers — loads and choices are in the focus already. */
  test('says what the logger will ask, and nothing of its own', () => {
    const focus = onSquat(logged(4))
    const { next } = loggerAsks(focus, new Set(), 'kg')
    expect(restAlertOf(focus, 'kg').body).toBe(`Barbell Back Squat — ${next.title}: 5 × 102.5 kg`)
  })

  test('in the athlete’s unit', () => {
    expect(restAlertOf(onSquat(logged(1)), 'lb').body).toBe(
      'Barbell Back Squat — Set 2 of 5: 5 × 225.97 lb',
    )
  })

  /** Without a plan, the exercise added: its next set, at the last one's numbers. */
  test('names an exercise added, as the logger counts it', () => {
    const curl = { id: 'curl', name: 'Bicep Curl', tracking: 'weight_reps' as const }
    const focus = {
      kind: 'added' as const,
      exercise: curl,
      sets: adHocSetsOf('curl', logged(2, null)),
      undone: null,
    }
    expect(restAlertOf(focus, 'kg').body).toBe('Bicep Curl — Set 3: 8 × 20 kg')
  })

  test('with nothing to name, only that the rest is over', () => {
    for (const focus of [{ kind: 'done' as const }, { kind: 'none' as const }]) {
      expect(restAlertOf(focus, 'kg')).toEqual({
        title: 'Rest over',
        body: 'Time for the next set.',
      })
    }
  })
})
