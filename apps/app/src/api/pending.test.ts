import { describe, expect, test } from 'bun:test'
import { type LogSetInput, focusOf } from '@cedo/contract'
import { type PendingLog, withPending } from './pending.ts'

const input = (entryId: string, isWarmup = false): LogSetInput => ({
  exerciseId: crypto.randomUUID(),
  entryId,
  weightG: 100_000,
  reps: 5,
  reserve: null,
  durationS: null,
  distanceMm: null,
  isWarmup,
})

const stored = (entryId: string, loggedAt: string): PendingLog => ({
  id: crypto.randomUUID(),
  exerciseId: crypto.randomUUID(),
  entryId,
  isWarmup: false,
  loggedAt,
  reps: 5,
  weightG: 100_000,
  durationS: null,
  distanceMm: null,
  reserve: null,
})

/** A set logged without a signal at `loggedAt`, by the device's clock. */
const queued = (key: string, entryId: string, loggedAt = '2026-10-25T18:00:00.000Z') => ({
  input: input(entryId),
  key,
  loggedAt,
})

describe('sets logged without a signal (#9), on the workout screen (#24)', () => {
  test('count as done, after every stored set, in the order logged', () => {
    const first = stored('squat', '2026-10-25T17:58:00Z')
    const logs = withPending(
      [first],
      [queued('a', 'squat'), { ...queued('b', 'rdl'), input: { ...input('rdl'), reserve: 2 } }],
    )
    expect(logs.map((l) => [l.id, l.entryId])).toEqual([
      [first.id, 'squat'],
      ['a', 'squat'],
      ['b', 'rdl'],
    ])
    // How hard each was, said before it was logged (#37), shown while it waits too.
    expect(logs.map((l) => l.reserve)).toEqual([null, null, 2])
    expect(logs.map((l) => l.loggedAt).toSorted()).toEqual(logs.map((l) => l.loggedAt))
  })

  /**
   * Its rest counts from it: dated afresh each time the screen was drawn, a tap sent the rest back
   * to the start.
   */
  test('dated when it was logged, however much later it is read', () => {
    const logs = withPending([stored('squat', '2026-10-25T17:58:00Z')], [queued('a', 'squat')])
    expect(logs[1]?.loggedAt).toBe('2026-10-25T18:00:00.000Z')
  })

  test('after the last stored set even when the server’s clock is ahead of the device', () => {
    // The server dated its set a minute in the device's future.
    const logs = withPending([stored('squat', '2026-10-25T18:01:00Z')], [queued('a', 'rdl')])
    expect(Date.parse(logs[1]?.loggedAt ?? '')).toBeGreaterThan(Date.parse('2026-10-25T18:01:00Z'))
  })

  test('each after the one before, though logged in the same millisecond', () => {
    const logs = withPending([], [queued('a', 'squat'), queued('b', 'squat')])
    expect(logs.map((l) => l.loggedAt)).toEqual([
      '2026-10-25T18:00:00.000Z',
      '2026-10-25T18:00:00.001Z',
    ])
  })

  test('so the focus moves on without a signal', () => {
    const entry = (id: string, index: number) => ({
      id,
      index,
      supersetGroup: null,
      exercise: {},
      sets: [
        {
          index: 0,
          isWarmup: false,
          target: { reps: 5, weightG: 100_000, reserve: null, durationS: null, distanceMm: null },
        },
      ],
    })
    const day = { entries: [entry('squat', 0), entry('rdl', 1)] }
    const logs = withPending([], [queued('a', 'squat')])
    expect(focusOf(day, logs)?.id).toBe('rdl')
  })
})
