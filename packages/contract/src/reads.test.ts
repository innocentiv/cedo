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
    expect(sorted(awaited)).toEqual([
      'exercise',
      'exerciseHistory',
      'exerciseList',
      'recentExercises',
    ])
    expect(sorted(background)).toEqual([
      'athleteHistory',
      'athleteReview',
      'athleteSession',
      'athleteSessions',
      'progression',
      'review',
      'session',
      'sessionList',
      'sessionTargets',
      'today',
      'workout',
    ])
  })

  /**
   * The session is read back before the next set is logged — its number comes from the logs. What
   * is computed FROM the logs catches up behind it, or the Log button stays busy until progression
   * has been recomputed.
   */
  test('logging a set awaits the session, and refreshes history and progression behind it', () => {
    const { awaited, background } = affectedBy('session')
    expect(sorted(awaited)).toEqual(['session', 'sessionList', 'today'])
    expect(sorted(background)).toEqual([
      'exerciseHistory',
      'progression',
      'recentExercises',
      'review',
    ])
  })

  /**
   * A session's targets are carried over the sessions BEFORE it, and those are finished — final —
   * so logging in it cannot move them. They used to be recomputed after every set, for nothing.
   */
  test("logging a set leaves the session's targets alone", () => {
    const { awaited, background } = affectedBy('session')
    expect([...awaited, ...background]).not.toContain('sessionTargets')
  })

  /**
   * A finished session can still be fixed (#31) — a set corrected or removed, or the session
   * deleted — and what the next session asks is carried over it. The fix refreshes all a write to
   * the session does, and the targets behind it.
   */
  test('fixing a finished session refreshes what logging does, and the targets', () => {
    const logging = affectedBy('session')
    const { awaited, background } = affectedBy('session', 'pastSession')
    expect(sorted(awaited)).toEqual(sorted(logging.awaited))
    expect(sorted(background)).toEqual(sorted([...logging.background, 'sessionTargets']))
  })

  /**
   * A live session points into its plan, and a save that removes an entry — or a delete — sets
   * those pointers to null. Left cached, the session kept a deleted plan's id and showed the plan
   * as unavailable rather than falling back to logging without one.
   */
  test('saving or deleting a plan refreshes its progression, and the sessions that point into it', () => {
    const { awaited, background } = affectedBy('workout')
    expect(sorted(awaited)).toEqual(['progression', 'sessionTargets', 'workout', 'workoutList'])
    expect(sorted(background)).toEqual([
      'athleteReview',
      'athleteSession',
      'athleteSessions',
      'review',
      'session',
      'sessionList',
      'today',
    ])
  })

  /**
   * Membership decides what every read but the token list may answer: leaving a group takes its
   * plans, its exercises and the names in your history with it. Left cached, a plan from a group
   * just left stayed listed — and opening it said it does not exist.
   */
  /** Saying what you train with (#35): every exercise you read says again whether you can do it. */
  test('saying what you train with refreshes it, and every read that says what is doable', () => {
    const { awaited, background } = affectedBy('equipment')
    expect(sorted(awaited)).toEqual(['equipment'])
    expect(sorted(background)).toEqual([
      'exercise',
      'exerciseList',
      'recentExercises',
      'session',
      'workout',
    ])
  })

  /** A note is written by the athlete and by their coach (#41): either refreshes both lists. */
  test('a note written refreshes your notes and an athlete’s, and nothing else', () => {
    const { awaited, background } = affectedBy('note')
    expect(sorted(awaited)).toEqual(['athleteNotes', 'notes'])
    expect(background).toEqual([])
  })

  /** Taken by the athlete or their coach (#42): both lists, and the reviews that say the latest. */
  test('a weigh-in taken refreshes both bodyweights, and the reviews behind them', () => {
    const { awaited, background } = affectedBy('weighIn')
    expect(sorted(awaited)).toEqual(['athleteBodyweight', 'bodyweight'])
    expect(sorted(background)).toEqual(['athleteReview', 'review'])
  })

  test('joining or leaving a group refreshes everything membership can show or hide', () => {
    const { awaited, background } = affectedBy('group')
    expect(sorted(awaited)).toEqual(['athletes', 'groupMembers', 'groups'])
    expect(sorted(background)).toEqual([
      'athleteBodyweight',
      'athleteEquipment',
      'athleteHistory',
      'athleteNotes',
      'athleteReview',
      'athleteSession',
      'athleteSessions',
      'exercise',
      'exerciseHistory',
      'exerciseList',
      'progression',
      'recentExercises',
      'review',
      'session',
      'sessionList',
      'sessionTargets',
      'today',
      'workout',
      'workoutList',
    ])
  })

  /**
   * A coach's own sets are theirs (#30): logging one must not hold the Log button while an athlete's
   * training is read again — nothing the coach does changes it.
   */
  test("a coach's own session leaves their athletes' training alone", () => {
    const { awaited, background } = affectedBy('session')
    expect([...awaited, ...background].filter((read) => read.startsWith('athlete'))).toEqual([])
  })

  test('a token touches nothing but the token list', () => {
    expect(affectedBy('token')).toEqual({ awaited: ['tokens'], background: [] })
  })
})

test('no read embeds the resource it is of — that would be one resource counted twice', () => {
  for (const sources of Object.values(READS)) {
    expect(sources.embeds as readonly string[]).not.toContain(sources.of)
  }
})
