import { describe, expect, test } from 'bun:test'
import { READS, type Read, affectedBy } from './reads.ts'

/**
 * What a write makes stale, stated as behaviour: each case is a screen that once showed, or would
 * show, an old answer for the cache's whole window.
 */

const sorted = (reads: readonly Read[]) => reads.toSorted()

describe('what a write makes stale', () => {
  /** The bug this table exists for: the plan kept the old name until the cache expired. */
  test('renaming an exercise refreshes the plan, its progression and a live session', () => {
    const { awaited, background } = affectedBy('exercise')
    expect(sorted(awaited)).toEqual(['exercise', 'exerciseHistory', 'exerciseList'])
    expect(sorted(background)).toEqual(['progression', 'session', 'workout'])
  })

  /**
   * The session is read back before the next set is logged — its number comes from the logs. What
   * is computed FROM the logs catches up behind it, or the Log button stays busy until progression
   * has been recomputed.
   */
  test('logging a set awaits the session, and refreshes history and progression behind it', () => {
    const { awaited, background } = affectedBy('session')
    expect(sorted(awaited)).toEqual(['session', 'sessionList'])
    expect(sorted(background)).toEqual(['exerciseHistory', 'progression'])
  })

  test('saving a plan refreshes its progression, and the sessions that name its days', () => {
    const { awaited, background } = affectedBy('workout')
    expect(sorted(awaited)).toEqual(['progression', 'workout', 'workoutList'])
    expect(sorted(background)).toEqual(['sessionList'])
  })

  test('a token touches nothing but the token list', () => {
    expect(affectedBy('token')).toEqual({ awaited: ['tokens'], background: [] })
  })

  /** A link is only an exercise's media once the exercise is saved with it, which is that write. */
  test('creating a media link makes nothing stale', () => {
    expect(affectedBy('media')).toEqual({ awaited: [], background: [] })
  })
})

test('no read embeds the resource it is of — that would be one resource counted twice', () => {
  for (const sources of Object.values(READS)) {
    expect(sources.embeds as readonly string[]).not.toContain(sources.of)
  }
})
