import { describe, expect, test } from 'bun:test'
import { ExerciseCreate, MUSCLE_SLUGS, TRACKING_MODES } from '@cedo/contract'
import { EXERCISE_LIBRARY, exerciseInputOf } from './exercises.ts'

/**
 * The library is data, and data rots silently. These run without a database so a bad entry fails
 * in the normal test loop rather than at deploy time on a stranger's machine.
 */
describe('starter exercise library', () => {
  test('is not accidentally empty or truncated', () => {
    expect(EXERCISE_LIBRARY.length).toBeGreaterThanOrEqual(40)
  })

  test('every entry satisfies the contract, including the sum-to-100 invariant', () => {
    const failures = EXERCISE_LIBRARY.flatMap((entry) => {
      const result = ExerciseCreate.safeParse(exerciseInputOf(entry))
      return result.success
        ? []
        : [`${entry.name}: ${result.error.issues.map((i) => i.message).join('; ')}`]
    })
    expect(failures).toEqual([])
  })

  test('names are unique — the seed matches on name to stay idempotent', () => {
    const names = EXERCISE_LIBRARY.map((e) => e.name)
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i)
    expect(duplicates).toEqual([])
  })

  /** The library audit reports an exercise without instructions; the library should not have one. */
  test('every entry says how to do it, and what it is', () => {
    const bare = EXERCISE_LIBRARY.filter(
      (e) => e.instructions.trim() === '' || e.description.trim() === '',
    ).map((e) => e.name)
    expect(bare).toEqual([])
  })

  test('every referenced muscle exists in the hardcoded set', () => {
    const unknown = EXERCISE_LIBRARY.flatMap((e) =>
      e.muscles.map(([m]) => m).filter((m) => !MUSCLE_SLUGS.includes(m)),
    )
    expect(unknown).toEqual([])
  })

  /** Every tracking mode should be exercised, or the mode is dead code nobody has tested. */
  test('covers all four tracking modes', () => {
    const used = new Set(EXERCISE_LIBRARY.map((e) => e.tracking ?? 'weight_reps'))
    expect([...used].toSorted()).toEqual([...TRACKING_MODES].toSorted())
  })

  test('the library covers every muscle at least once', () => {
    const covered = new Set(EXERCISE_LIBRARY.flatMap((e) => e.muscles.map(([m]) => m)))
    const uncovered = MUSCLE_SLUGS.filter((m) => !covered.has(m))
    expect(uncovered).toEqual([])
  })
})
