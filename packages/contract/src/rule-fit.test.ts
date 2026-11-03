import { describe, expect, test } from 'bun:test'
import { ruleLabel, ruleMisfit, rulesFor } from './rule-fit.ts'

/**
 * Which progression rules fit an exercise, by how it is measured (ADR-0026, #22): a rule that moves
 * a dimension the exercise never logs can never advance. One answer, asked by the plan save, the
 * editor and MCP alike.
 */
describe('the rules that fit a tracking mode', () => {
  test('a lift, weighted or bodyweight, takes double, linear or manual — the editor’s order', () => {
    expect(rulesFor('weight_reps')).toEqual(['double', 'linear', 'none'])
    expect(rulesFor('bodyweight_reps')).toEqual(['double', 'linear', 'none'])
  })

  test('a hold takes linear duration or manual; a run, distance or manual', () => {
    expect(rulesFor('duration')).toEqual(['linear_duration', 'none'])
    expect(rulesFor('distance_duration')).toEqual(['linear_distance', 'none'])
  })

  test('a rule that does not fit says which do', () => {
    expect(ruleMisfit('double', 'duration')).toBe(
      'A timed exercise takes linear duration (adds seconds) or Manual, not double',
    )
    expect(ruleMisfit('linear_distance', 'weight_reps')).toBe(
      'A weight lift takes double, linear (adds weight) or Manual, not distance',
    )
    expect(ruleMisfit('linear', 'distance_duration')).toBe(
      'A distance exercise takes distance (further, at the same pace) or Manual, not linear',
    )
  })

  test('a rule that fits says nothing', () => {
    expect(ruleMisfit('double', 'bodyweight_reps')).toBeNull()
    expect(ruleMisfit('none', 'duration')).toBeNull()
  })
})

/** Each rule as the editor offers it — one name in one place, beside the refusals' words. */
test('ruleLabel', () => {
  const kinds: Parameters<typeof ruleLabel>[0][] = [
    'double',
    'linear',
    'none',
    'linear_duration',
    'linear_distance',
  ]
  expect(kinds.map((kind) => ruleLabel(kind))).toEqual([
    'Double',
    'Linear',
    'Manual',
    'Linear',
    'Distance',
  ])
})
