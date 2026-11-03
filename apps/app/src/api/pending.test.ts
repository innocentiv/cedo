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

describe('sets logged without a signal (#9), on the workout screen (#24)', () => {
  test('count as done, after every stored set, in the order logged', () => {
    const now = Date.parse('2026-10-25T18:00:00Z')
    const first = stored('squat', '2026-10-25T17:58:00Z')
    const logs = withPending(
      [first],
      [
        { input: input('squat'), key: 'a' },
        { input: { ...input('rdl'), reserve: 2 }, key: 'b' },
      ],
      now,
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

  test('after the last stored set even when the server’s clock is ahead of the device', () => {
    // The server dated its set a minute in the device's future.
    const logs = withPending(
      [stored('squat', '2026-10-25T18:01:00Z')],
      [{ input: input('rdl'), key: 'a' }],
      Date.parse('2026-10-25T18:00:00Z'),
    )
    expect(Date.parse(logs[1]?.loggedAt ?? '')).toBeGreaterThan(Date.parse('2026-10-25T18:01:00Z'))
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
    const logs = withPending([], [{ input: input('squat'), key: 'a' }], Date.now())
    expect(focusOf(day, logs)?.id).toBe('rdl')
  })
})
