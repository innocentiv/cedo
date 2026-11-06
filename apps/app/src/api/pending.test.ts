import { describe, expect, test } from 'bun:test'
import { type LogSetInput, focusOf } from '@cedo/contract'
import { type PendingLog, type QueuedSend, setsOfSession, withPending } from './pending.ts'

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

/** A session's sets as the workout reads them, from the session and the queue read once. */
describe('a session’s sets, sent and not', () => {
  const sending = (set = queued(crypto.randomUUID(), 'squat')): QueuedSend => ({
    set,
    paused: false,
    failures: 0,
  })
  const offline = (set = queued(crypto.randomUUID(), 'squat')): QueuedSend => ({
    ...sending(set),
    paused: true,
  })
  const resent = (set = queued(crypto.randomUUID(), 'squat')): QueuedSend => ({
    ...sending(set),
    failures: 1,
  })
  const server = [stored('squat', '2026-10-25T17:58:00Z')]

  test('the sets not sent are listed in the order logged, waiting, and counted as done', () => {
    const [a, b] = [queued('a', 'squat'), queued('b', 'rdl')]
    const sets = setsOfSession(server, [offline(a), offline(b)])
    expect(sets.unsent).toEqual([a, b])
    expect([...sets.waiting]).toEqual(['a', 'b'])
    expect(sets.all.map((l) => l.id)).toEqual([...server.map((l) => l.id), 'a', 'b'])
  })

  test('a send not yet holding its set is none of them', () => {
    const sets = setsOfSession(server, [{ set: undefined, paused: false, failures: 0 }])
    expect([sets.unsent, sets.all.length]).toEqual([[], 1])
  })

  test('held up while one waits for a signal, or is sent again after a lost answer', () => {
    expect(setsOfSession(server, [offline()]).heldUp).toBe(true)
    expect(setsOfSession(server, [resent()]).heldUp).toBe(true)
    expect(setsOfSession(server, [sending()]).heldUp).toBe(false)
    expect(setsOfSession(server, []).heldUp).toBe(false)
  })

  /** The next set waits for a first send on its way; behind one held up, it queues instead. */
  test('busy only while the last set’s first send is on its way', () => {
    expect(setsOfSession(server, [sending()]).busy).toBe(true)
    expect(setsOfSession(server, [offline(), offline()]).busy).toBe(false)
    expect(setsOfSession(server, [resent(), offline()]).busy).toBe(false)
    expect(setsOfSession(server, []).busy).toBe(false)
    // The signal back, the queue drains in order: the last set waits its turn, so Log is free.
    expect(setsOfSession(server, [sending(), offline()]).busy).toBe(false)
  })
})
