import { describe, expect, spyOn, test } from 'bun:test'
import type { RestPhase } from '@cedo/contract'
import {
  type AlertKind,
  type AlertScheduler,
  type Wanted,
  chimesInApp,
  createAlertKind,
  createRestAlerts,
  kindOf,
  offersToTell,
  secondsUntil,
  wantedAlert,
} from './rest-alert.ts'

/**
 * What this phone has set to tell the end of a rest (#39), without a phone: a fake scheduler
 * recording what it is asked, as session.test.ts has a fake keychain.
 */

const SAID = { title: 'Rest over', body: 'Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg' }
const running = (left: number): RestPhase => ({ phase: 'running', left })
const NOW = Date.parse('2026-11-09T18:00:00Z')

const want = (phase: RestPhase, kind: AlertKind = 'notification', now = NOW) =>
  wantedAlert({ kind, phase, said: SAID, sessionId: 'session-1', now })

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
    expect(want({ phase: 'over', skipped: false }, 'off')).toBeNull()
    expect(want({ phase: 'none' })).toBeNull()
    expect(want({ phase: 'over', skipped: true })).toBeNull()
  })

  /** At its end it is ringing, or shown: told, not to be taken back. */
  test('is told once the rest has run out', () => {
    expect(want({ phase: 'over', skipped: false })).toBe('told')
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

describe('when iOS is asked to tell it', () => {
  test('is the whole seconds to the end, by this phone’s clock', () => {
    expect(secondsUntil(NOW + 90_400, NOW)).toBe(90)
    expect(secondsUntil(NOW + 89_600, NOW)).toBe(90)
  })

  /** iOS refuses an alert due now or past; one second on, it is told at once. */
  test('is never less than a second away', () => {
    expect(secondsUntil(NOW + 200, NOW)).toBe(1)
    expect(secondsUntil(NOW - 5000, NOW)).toBe(1)
  })
})

describe('the rest band', () => {
  /** "Tell me when rest is over" turns on a notification: shown only while nothing tells it. */
  test('offers to tell a rest’s end only while nothing does', () => {
    expect(offersToTell('off')).toBe(true)
    expect(offersToTell('notification')).toBe(false)
    expect(offersToTell('alarm')).toBe(false)
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

  /**
   * The phone sees the rest run out as the alert goes off: cancelling it then would silence an alarm
   * as it starts to ring. The next rest's replaces it.
   */
  test('is left alone when the rest runs out', async () => {
    const scheduler = aScheduler()
    const alerts = createRestAlerts(scheduler)
    await alerts.follow(want(running(1)))
    await alerts.follow(want({ phase: 'over', skipped: false }))
    await alerts.follow(want(running(90)))
    expect(scheduler.asked).toEqual(['notification at +1s', 'notification at +90s'])
  })

  /** Finished here, or on another device: no clock runs on a finished session to cancel it. */
  test('is cancelled when its session is finished, and not by another’s', async () => {
    const scheduler = aScheduler()
    const alerts = createRestAlerts(scheduler)
    await alerts.follow(want(running(90)))
    await alerts.end('session-0')
    expect(scheduler.asked).toEqual(['notification at +90s'])
    await alerts.end('session-1')
    await alerts.end('session-1')
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

/** The keychain, as a fake: what it holds, and what it is asked to keep. */
function aKeychain(held: string | null) {
  const kept: string[] = []
  return {
    kept,
    read: async () => held,
    write: async (value: string) => {
      kept.push(value)
      held = value
    },
    clear: async () => {
      held = null
    },
  }
}

/** iOS, as a fake: what it was asked, and what it answers. */
function anIos(allows: boolean) {
  const asked: string[] = []
  return {
    asked,
    allow: async (kind: AlertKind) => {
      asked.push(kind)
      return allows
    },
  }
}

const aChoice = (keychain = aKeychain(null), ios = anIos(true), scheduler = aScheduler()) =>
  createAlertKind({ store: keychain, allow: ios.allow, alerts: createRestAlerts(scheduler) })

describe('how this phone tells a rest’s end', () => {
  test('is off until the keychain is read, then what it keeps', async () => {
    const choice = aChoice(aKeychain('alarm'))
    expect(choice.snapshot()).toBe('off')
    await choice.restore()
    expect(choice.snapshot()).toBe('alarm')
  })

  test('is kept once iOS allows it, and heard by whoever listens', async () => {
    const keychain = aKeychain(null)
    const ios = anIos(true)
    const choice = aChoice(keychain, ios)
    await choice.restore()
    const heard: string[] = []
    choice.subscribe(() => {
      heard.push(choice.snapshot())
    })
    expect(await choice.choose('notification')).toBe(true)
    expect(ios.asked).toEqual(['notification'])
    expect(keychain.kept).toEqual(['notification'])
    expect(heard).toEqual(['notification'])
  })

  /** iOS asks once; refused, nothing is kept, and the screen says where to allow it. */
  test('is not kept when iOS refuses it', async () => {
    const keychain = aKeychain('notification')
    const choice = aChoice(keychain, anIos(false))
    await choice.restore()
    expect(await choice.choose('alarm')).toBe(false)
    expect(keychain.kept).toEqual([])
    expect(choice.snapshot()).toBe('notification')
  })

  /** A rest whose screen is not open is not followed: turned off, what it set is cancelled at once. */
  test('turned off, cancels what was set, and asks iOS nothing', async () => {
    const scheduler = aScheduler()
    const alerts = createRestAlerts(scheduler)
    const ios = anIos(true)
    const choice = createAlertKind({ store: aKeychain('notification'), allow: ios.allow, alerts })
    await alerts.follow(want(running(90)))
    expect(await choice.choose('off')).toBe(true)
    expect(ios.asked).toEqual([])
    expect(scheduler.asked).toEqual(['notification at +90s', 'cancel notification'])
  })

  /** A keychain that throws must not take the app down: nothing tells, as before it was chosen. */
  test('is off when the keychain cannot be read', async () => {
    const choice = aChoice({
      ...aKeychain(null),
      read: async () => {
        throw new Error('keychain locked')
      },
    })
    const errors = spyOn(console, 'error').mockImplementation(() => null)
    try {
      await choice.restore()
    } finally {
      errors.mockRestore()
    }
    expect(choice.snapshot()).toBe('off')
  })
})
