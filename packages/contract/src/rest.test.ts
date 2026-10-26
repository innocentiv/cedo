import { describe, expect, test } from 'bun:test'
import { DEFAULT_REST_S, restCounted, restLeft, restRemaining } from './rest.ts'

/** What the logger counts down after a working set: the entry's rest, from when it was logged. */
describe('rest left', () => {
  const at = (iso: string) => Date.parse(iso)
  const log = (loggedAt: string, isWarmup = false) => ({ entryId: 'e', loggedAt, isWarmup })

  test('is the rest, less the time since the latest working set', () => {
    const logs = [log('2026-10-21T10:00:00Z'), log('2026-10-21T10:02:30Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 120 }, at('2026-10-21T10:03:00Z'))).toBe(90)
  })

  test('counts in whole seconds, rounding up: 0 only once it is over', () => {
    const logs = [log('2026-10-21T10:00:00Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 60 }, at('2026-10-21T10:00:59.400Z'))).toBe(1)
    expect(restLeft(logs, { id: 'e', restSeconds: 60 }, at('2026-10-21T10:01:00Z'))).toBe(0)
    expect(restLeft(logs, { id: 'e', restSeconds: 60 }, at('2026-10-21T10:05:00Z'))).toBe(0)
  })

  /** A warm-up is the ramp to the work, not a set the rest is for. */
  test('starts from a working set — never a warm-up, nor another entry’s set', () => {
    const logs = [
      log('2026-10-21T10:00:00Z'),
      log('2026-10-21T10:01:00Z', true),
      { entryId: 'other', loggedAt: '2026-10-21T10:01:30Z', isWarmup: false },
    ]
    expect(restLeft(logs, { id: 'e', restSeconds: 120 }, at('2026-10-21T10:01:40Z'))).toBe(20)
  })

  /**
   * The set's time is the server's, the clock reading it the device's, and the two disagree: a
   * set can look logged a moment in the future. The rest is never longer than prescribed.
   */
  test('is never more than the rest, however far ahead the server’s clock is', () => {
    const logs = [log('2026-10-21T10:00:01.500Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 5 }, at('2026-10-21T10:00:00Z'))).toBe(5)
  })

  /** A rest of none is "straight on" — a superset's first exercise — not a rest that is over. */
  test('is nothing for a rest of 0: straight on, not over', () => {
    const logs = [log('2026-10-21T10:00:00Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 0 }, at('2026-10-21T10:00:01Z'))).toBeNull()
  })

  test('falls back to the working set before, once the latest is undone', () => {
    const logs = [log('2026-10-21T10:00:00Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 120 }, at('2026-10-21T10:01:00Z'))).toBe(60)
  })

  test('is two minutes, by default', () => {
    expect(DEFAULT_REST_S).toBe(120)
  })

  test('is nothing before the first working set, or without a rest prescribed', () => {
    expect(restLeft([], { id: 'e', restSeconds: 120 }, at('2026-10-21T10:00:00Z'))).toBeNull()
    const logs = [log('2026-10-21T10:00:00Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: null }, at('2026-10-21T10:00:10Z'))).toBeNull()
  })
})

describe('a rest running, extended', () => {
  const rest = { since: '2026-10-25T18:00:00Z', seconds: 90 }
  const at = (s: number) => Date.parse('2026-10-25T18:00:00Z') + s * 1000

  test('counts down from when the set was logged, and +30 s adds thirty each time', () => {
    expect(restRemaining(rest, 0, at(30))).toBe(60)
    expect(restRemaining(rest, 1, at(30))).toBe(90)
    expect(restRemaining(rest, 2, at(100))).toBe(50)
  })

  test('never below zero, nor more than the rest against a server clock ahead', () => {
    expect(restRemaining(rest, 0, at(500))).toBe(0)
    expect(restRemaining(rest, 0, at(-20))).toBe(90)
  })
})

/** The countdown and what the server keeps (#38): the longer, never the two added. */
describe('the rest counted', () => {
  const since = '2026-10-26T18:00:00.000Z'
  const counted = { since, seconds: 90 }
  const kept = (seconds: number, at = since) => ({
    since: at,
    endsAt: new Date(Date.parse(at) + seconds * 1000).toISOString(),
  })

  test('a tap here, already kept there, is counted once', () => {
    expect(restCounted(counted, 1, kept(120)).seconds).toBe(120)
  })

  test('a tap on another device, or before a reload, is the server’s to know', () => {
    expect(restCounted(counted, 0, kept(150)).seconds).toBe(150)
  })

  test('a tap here not yet kept there counts, and a rest the server does not keep is the sets’', () => {
    expect(restCounted(counted, 2, kept(90)).seconds).toBe(150)
    expect(restCounted(counted, 0, null).seconds).toBe(90)
  })

  test('what the server keeps of an earlier rest is not this one', () => {
    expect(restCounted(counted, 0, kept(300, '2026-10-26T17:55:00.000Z')).seconds).toBe(90)
  })
})
