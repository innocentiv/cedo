import { describe, expect, test } from 'bun:test'
import {
  type AthleteEquipment,
  ExerciseCreate,
  MUSCLE_SLUGS,
  type MuscleSlug,
  TRACKING_MODES,
  isDoable,
  parseMediaUrl,
} from '@cedo/contract'
import { EXERCISE_LIBRARY, type SeedExercise, exerciseInputOf } from './exercises.ts'

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

  /**
   * A video id was checked to exist when it was chosen (YouTube's oEmbed answered for it); this
   * checks it is still a YouTube video id at all, and that only the entries known to have no video
   * fall back to a search.
   */
  test('every entry names a YouTube video, but the ones none was found for', () => {
    const notYouTube = EXERCISE_LIBRARY.filter((e) => e.video !== undefined)
      .filter((e) => parseMediaUrl(e.video ?? '')?.provider !== 'youtube')
      .map((e) => e.name)
    expect(notYouTube).toEqual([])
    const searched = EXERCISE_LIBRARY.filter((e) => e.video === undefined).map((e) => e.name)
    expect(searched).toEqual(['Incline Dumbbell Y-Raise'])
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
    expect(uncoveredBy(EXERCISE_LIBRARY)).toEqual([])
  })

  /**
   * Covered by the library is not covered for an athlete (#46): a home gym with one cable stack
   * could do none of the calf raises, all on calf machines. A common setup that trains no muscle at
   * all is a gap in the library, however many machines cover it.
   */
  test('a home gym with one cable stack trains every muscle', () => {
    const homeGym: AthleteEquipment = {
      described: true,
      items: (
        [
          'dumbbells',
          'flat_bench',
          'barbell',
          // A barbell comes with plates, though the list keeps them apart: without them, this gym
          // trains no neck muscle — both neck exercises are loaded with a plate (#46 review).
          'weight_plates',
          'rack',
          'high_pulley',
          'low_pulley',
          'leg_extension',
          'lying_leg_curl',
        ] as const
      ).map((slug) => ({ slug, weights: null })),
    }
    expect(uncoveredBy(EXERCISE_LIBRARY.filter((e) => isDoable(e.equipment, homeGym)))).toEqual([])
  })
})

/** The muscles none of `entries` trains. */
function uncoveredBy(entries: readonly SeedExercise[]): MuscleSlug[] {
  const covered = new Set(entries.flatMap((e) => e.muscles.map(([m]) => m)))
  return MUSCLE_SLUGS.filter((m) => !covered.has(m))
}
