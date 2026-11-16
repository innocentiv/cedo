import { describe, expect, test } from 'bun:test'
import type { TrackingMode } from './exercise.ts'
import type { Load } from './load.ts'
import { newEntry, progressionOf } from './plan-editing.ts'
import { NO_PROGRESSION, type Progression } from './progression.ts'
import { type RuleSettingName, ruleSettings } from './rule-settings.ts'
import { kgToG, lbToG } from './units.ts'
import type { WeightUnit } from './units.ts'

/**
 * A rule's own settings, as the plan editor shows them, and what each becomes when changed or
 * emptied — the numbers a person types under Progression, without the screen.
 */

const LIFT = { id: 'squat', tracking: 'weight_reps' } as const
const HOLD = { id: 'plank', tracking: 'duration' } as const
const RUN = { id: 'run', tracking: 'distance_duration' } as const

/** A new entry of this exercise under a new rule of `kind`, as the editor makes one. */
const under = (
  kind: Progression['kind'],
  exercise: { readonly id: string; readonly tracking: TrackingMode } = LIFT,
  unit: WeightUnit = 'kg',
) => {
  const entry = newEntry(exercise)
  return { ...entry, progression: progressionOf(kind, NO_PROGRESSION, unit) }
}

/** Dumbbells that go 2 kg at a time (#36). */
const DUMBBELLS: Load = {
  stepG: kgToG(2),
  minG: kgToG(2),
  maxG: kgToG(30),
  assisted: false,
  unit: 'kg',
}

const shown = (entry: ReturnType<typeof under>, unit: WeightUnit = 'kg') =>
  ruleSettings(entry, unit, null).map(({ name, label, input, value }) => ({
    name,
    label,
    input,
    value,
  }))

/** One setting of an entry's rule, changed to `value`, in `unit`, with `load` known or not. */
function changed(
  entry: ReturnType<typeof under>,
  name: RuleSettingName,
  value: number | null,
  { unit = 'kg', load = null }: { unit?: WeightUnit; load?: Load | null } = {},
) {
  const setting = ruleSettings(entry, unit, load).find((s) => s.name === name)
  if (setting === undefined) throw new Error(`${entry.progression.kind} has no ${name}`)
  return setting.change(value)
}

describe('a rule’s settings', () => {
  test('Manual has none', () => {
    expect(shown(under('none'))).toEqual([])
  })

  test('Double: its range, then the weight it adds', () => {
    expect(shown(under('double'))).toEqual([
      { name: 'from', label: 'From', input: 'count', value: 8 },
      { name: 'to', label: 'To', input: 'count', value: 12 },
      { name: 'increase', label: 'Increase, kg', input: 'weight', value: kgToG(2.5) },
    ])
  })

  test('Linear: the weight it adds, in the person’s unit, then after how many sessions', () => {
    expect(shown(under('linear', LIFT, 'lb'), 'lb')).toEqual([
      { name: 'increase', label: 'Increase, lb', input: 'weight', value: lbToG(5) },
      { name: 'after', label: 'After sessions', input: 'count', value: 1 },
    ])
  })

  test('a hold’s Linear: the time it adds, then after how many sessions', () => {
    expect(shown(under('linear_duration', HOLD))).toEqual([
      { name: 'increase', label: 'Increase', input: 'duration', value: 15 },
      { name: 'after', label: 'After sessions', input: 'count', value: 1 },
    ])
  })

  test('Distance: the distance it adds, then after how many sessions', () => {
    expect(shown(under('linear_distance', RUN))).toEqual([
      { name: 'increase', label: 'Increase, m', input: 'distance', value: 500_000 },
      { name: 'after', label: 'After sessions', input: 'count', value: 1 },
    ])
  })
})

describe('a rule’s setting changed', () => {
  test('is the rule with it changed, and nothing else', () => {
    const entry = under('linear')
    const next = changed(entry, 'increase', kgToG(5))
    expect(next).toEqual({
      ...entry,
      progression: { kind: 'linear', incrementG: kgToG(5), afterSuccesses: 1 },
    })
  })

  /** "Start at" never shows reps outside the range (`withRange`). */
  test('a double’s range moves the working sets’ reps into it', () => {
    const entry = under('double')
    const next = changed(entry, 'from', 10)
    expect(next.progression).toMatchObject({ repRange: [10, 12] })
    expect(next.sets.map((s) => s.targetReps)).toEqual([10, 10, 10])
    expect(changed(entry, 'to', 15).progression).toMatchObject({ repRange: [8, 15] })
  })

  test('after how many sessions: one at least', () => {
    const entry = under('linear')
    expect(changed(entry, 'after', 3).progression).toMatchObject({ afterSuccesses: 3 })
    expect(changed(entry, 'after', 0).progression).toMatchObject({ afterSuccesses: 1 })
    expect(changed(entry, 'after', null).progression).toMatchObject({ afterSuccesses: 1 })
  })

  /** Kept as typed above the schema's ten: the plan's line says so (`planIssues`), as on save. */
  test('after how many sessions: more than the schema allows is kept as typed', () => {
    expect(changed(under('linear'), 'after', 11).progression).toMatchObject({ afterSuccesses: 11 })
  })
})

describe('a rule’s setting emptied', () => {
  test('an end of a double’s range is 1', () => {
    const entry = under('double')
    expect(changed(entry, 'from', null).progression).toMatchObject({ repRange: [1, 12] })
    expect(changed(entry, 'to', null).progression).toMatchObject({ repRange: [8, 1] })
  })

  test('a weight increase is one step of what the athlete can load, when it is known', () => {
    expect(
      changed(under('double'), 'increase', null, { load: DUMBBELLS }).progression,
    ).toMatchObject({ incrementG: kgToG(2) })
  })

  test('a weight increase is 2.5 kg, or 5 lb, when it is not', () => {
    expect(changed(under('linear'), 'increase', null).progression).toMatchObject({
      incrementG: kgToG(2.5),
    })
    expect(changed(under('linear'), 'increase', null, { unit: 'lb' }).progression).toMatchObject({
      incrementG: lbToG(5),
    })
  })

  test('a hold’s increase is 15 s, a distance’s 500 m', () => {
    expect(changed(under('linear_duration', HOLD), 'increase', null).progression).toMatchObject({
      incrementS: 15,
    })
    expect(changed(under('linear_distance', RUN), 'increase', null).progression).toMatchObject({
      incrementMm: 500_000,
    })
  })
})
