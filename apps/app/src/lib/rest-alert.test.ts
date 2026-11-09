import { describe, expect, test } from 'bun:test'
import type { RestPhase } from '@cedo/contract'
import {
  type AlertScheduler,
  type Wanted,
  chimesInApp,
  createRestAlerts,
  kindOf,
  wantedAlert,
} from './rest-alert.ts'

/**
 * What this phone has set to tell the end of a rest (#39), without a phone: a fake scheduler
 * recording what it is asked, as session.test.ts has a fake keychain.
 */

const SAID = { title: 'Rest over', body: 'Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg' }
const running = (left: number): RestPhase => ({ phase: 'running', left })
const NOW = Date.parse('2026-11-09T18:00:00Z')

const want = (
  phase: RestPhase,
  kind: 'off' | 'notification' | 'alarm' = 'notification',
  now = NOW,
) => wantedAlert({ kind, phase, said: SAID, sessionId: 'session-1', now })

function aScheduler(): AlertScheduler & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    schedule: async (wanted) => {
      asked.push(`${wanted.kind} at +${String((wanted.endsAt - NOW) / 1000)}s`)
    },
    cancel: async (kind) => {
      asked.push(`cancel ${kind}`)
    },
  }
}

describe('the alert a rest wants', () => {
  test('is set for when the rest the phone counts ends, by its own clock', () => {
    expect(want(running(90))).toEqual({
      kind: 'notification',
      endsAt: NOW + 90_000,
      sessionId: 'session-1',
      ...SAID,
    })
  })

  test('is none when telling is off, or no rest runs', () => {
    expect(want(running(90), 'off')).toBeNull()
    expect(want({ phase: 'none' })).toBeNull()
    expect(want({ phase: 'over', skipped: false })).toBeNull()
    expect(want({ phase: 'over', skipped: true })).toBeNull()
  })
})

describe('the app’s own chime', () => {
  /** An alarm rings even with the app in front; the chime would sound beside it. */
  test('plays at a rest’s end unless an alarm will ring for it', () => {
    expect(chimesInApp('off')).toBe(true)
    expect(chimesInApp('notification')).toBe(true)
    expect(chimesInApp('alarm')).toBe(false)
  })
})

describe('the kind of alert this phone keeps', () => {
  test('is the one kept, or off when nothing, or something else, is', () => {
    expect(kindOf('alarm')).toBe('alarm')
    expect(kindOf('notification')).toBe('notification')
    expect(kindOf(null)).toBe('off')
    expect(kindOf('push')).toBe('off')
  })
})

describe('what this phone has set', () => {
  test('is the rest’s end, once, however often the clock ticks', async () => {
    const scheduler = aScheduler()
    const alerts = createRestAlerts(scheduler)
    for (let second = 0; second < 5; second += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one tick after another, as the clock runs.
      await alerts.follow(want(running(90 - second), 'notification', NOW + second * 1000))
    }
    expect(scheduler.asked).toEqual(['notification at +90s'])
  })

  /** +30 s, from this phone or another: the rest ends later, and so does its alert. */
  test('moves when the rest is made longer', async () => {
    const scheduler = aScheduler()
    const alerts = createRestAlerts(scheduler)
    await alerts.follow(want(running(90)))
    await alerts.follow(want(running(120)))
    expect(scheduler.asked).toEqual(['notification at +90s', 'notification at +120s'])
  })

  /** Skipped, undone, the next set logged, finished or deleted: no rest runs, and nothing tells it. */
  test('is cancelled when the rest stops running', async () => {
    const scheduler = aScheduler()
    const alerts = createRestAlerts(scheduler)
    await alerts.follow(want(running(90)))
    await alerts.follow(want({ phase: 'over', skipped: true }))
    await alerts.follow(want({ phase: 'none' }))
    expect(scheduler.asked).toEqual(['notification at +90s', 'cancel notification'])
  })

  /** One kind per rest, never both. */
  test('changes kind by cancelling the one set before setting the other', async () => {
    const scheduler = aScheduler()
    const alerts = createRestAlerts(scheduler)
    await alerts.follow(want(running(90)))
    await alerts.follow(want(running(90), 'alarm'))
    await alerts.follow(want(running(90), 'off'))
    expect(scheduler.asked).toEqual([
      'notification at +90s',
      'cancel notification',
      'alarm at +90s',
      'cancel alarm',
    ])
  })

  /** Two changes in a row — a set logged, then +30 s — reach the phone in the order they came. */
  test('follows changes one at a time, in order', async () => {
    const asked: string[] = []
    let finishFirst: () => void = () => null
    let begun: () => void = () => null
    const firstBegun = new Promise<void>((resolve) => {
      begun = resolve
    })
    let calls = 0
    const slow: AlertScheduler = {
      schedule: async (wanted: Wanted) => {
        calls += 1
        if (calls === 1) {
          begun()
          await new Promise<void>((resolve) => {
            finishFirst = resolve
          })
        }
        asked.push(`at +${String((wanted.endsAt - NOW) / 1000)}s`)
      },
      cancel: async () => {
        asked.push('cancel')
      },
    }
    const alerts = createRestAlerts(slow)
    const first = alerts.follow(want(running(90)))
    const second = alerts.follow(want(running(120)))
    await firstBegun
    finishFirst()
    await Promise.all([first, second])
    expect(asked).toEqual(['at +90s', 'at +120s'])
  })
})
