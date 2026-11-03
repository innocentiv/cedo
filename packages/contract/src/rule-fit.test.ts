import { describe, expect, test } from 'bun:test'
import { ruleMisfit, rulesFor } from './rule-fit.ts'

/**
 * Which progression rules fit an exercise, by how it is measured (ADR-0026, #22): a rule that moves
 * a dimension the exercise never logs can never advance. One answer, asked by the plan save, the
 * editor and MCP alike.
 */
describe('the rules that fit a tracking mode', () => {
  test('a lift, weighted or bodyweight, takes manual, linear or double', () => {
    expect(rulesFor('weight_reps')).toEqual(['none', 'linear', 'double'])
    expect(rulesFor('bodyweight_reps')).toEqual(['none', 'linear', 'double'])
  })

  test('a hold takes manual or linear duration; a run, manual or distance', () => {
    expect(rulesFor('duration')).toEqual(['none', 'linear_duration'])
    expect(rulesFor('distance_duration')).toEqual(['none', 'linear_distance'])
  })

  test('a rule that does not fit says which do', () => {
    expect(ruleMisfit('double', 'duration')).toBe(
      'A timed exercise takes Manual or linear duration (adds seconds), not double',
    )
    expect(ruleMisfit('linear_distance', 'weight_reps')).toBe(
      'A weight lift takes Manual, linear (adds weight) or double, not distance',
    )
    expect(ruleMisfit('linear', 'distance_duration')).toBe(
      'A distance exercise takes Manual or distance (further, at the same pace), not linear',
    )
  })

  test('a rule that fits says nothing', () => {
    expect(ruleMisfit('double', 'bodyweight_reps')).toBeNull()
    expect(ruleMisfit('none', 'duration')).toBeNull()
  })
})
