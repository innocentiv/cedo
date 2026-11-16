import { describe, expect, test } from 'bun:test'
import { type RestPhase, sToMs } from '@cedo/contract'
import {
  type AlertDevice,
  type RestNotification,
  type Wanted,
  chimesInApp,
  createRestAlerts,
  secondsUntil,
  sessionTapped,
  wantedAlert,
} from './rest-alert.ts'
import type { AlertKind } from './rest-alert-kind.ts'

/**
 * What this phone has set to tell the end of a rest (#39), without a phone: a fake one recording
 * each of its calls as it is asked, as session.test.ts has a fake keychain.
 */

const SAID = { title: 'Rest over', body: 'Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg' }
const running = (left: number): RestPhase => ({ phase: 'running', left })
const RUN_OUT: RestPhase = { phase: 'over', skipped: false }
const NOW = Date.parse('2026-11-09T18:00:00Z')

const want = (phase: RestPhase, kind: AlertKind = 'notification', now = NOW) =>
  wantedAlert({ kind, phase, said: SAID, sessionId: 'session-1', now })

/** The phone, as a fake: each of its calls, in the order it is asked. */
function aPhone(): AlertDevice & { asked: string[] } {
  const asked: string[] = []
  const call = (name: string) => async () => {
    asked.push(name)
  }
  return {
    asked,
    showCountdown: async (seconds) => {
      asked.push(`countdown ${String(seconds)}s`)
    },
    endCountdown: call('end countdown'),
    endCountdownIfOver: call('end countdown if over'),
    scheduleNotification: async ({ seconds }) => {
      asked.push(`notification in ${String(seconds)}s`)
    },
    cancelNotification: call('cancel notification'),
    dismissNotification: call('dismiss notification'),
    scheduleAlarm: async (seconds) => {
      asked.push(`alarm in ${String(seconds)}s`)
    },
    cancelAlarm: call('cancel alarm'),
  }
}

/** A notification set: the rest counting down beside it, from the same second. */
const notified = (seconds: number): string[] => [
  `countdown ${String(seconds)}s`,
  `notification in ${String(seconds)}s`,
]

/** A notification cancelled: the one pending, the one shown, and its countdown. */
const UNNOTIFIED = ['cancel notification', 'dismiss notification', 'end countdown']

/** A phone whose first notification waits until let go: a change still on its way to iOS. */
function aSlowPhone() {
  const phone = aPhone()
  let letGo: () => void = () => null
  let begun: () => void = () => null
  const started = new Promise<void>((resolve) => {
    begun = resolve
  })
  let calls = 0
  const device: AlertDevice = {
    ...phone,
    scheduleNotification: async (notification) => {
      calls += 1
      if (calls === 1) {
        begun()
        await new Promise<void>((resolve) => {
          letGo = resolve
        })
      }
      await phone.scheduleNotification(notification)
    },
  }
  return { asked: phone.asked, device, started, letGo: () => letGo() }
}

const alertsOn = (
  phone: AlertDevice = aPhone(),
  { now = () => NOW, inFront = () => false }: { now?: () => number; inFront?: () => boolean } = {},
) => createRestAlerts({ device: phone, now, inFront })

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
    expect(want(RUN_OUT, 'off')).toBeNull()
    expect(want({ phase: 'none' })).toBeNull()
    expect(want({ phase: 'over', skipped: true })).toBeNull()
  })

  /** At its end it is ringing, or shown: told, not to be taken back. */
  test('is told once the rest has run out', () => {
    expect(want(RUN_OUT)).toBe('told')
  })
})

describe('the app’s own chime', () => {
  /** An alarm rings even with the app in front; the chime would sound beside it. */
  test('plays at a rest’s end unless an alarm is set for it', () => {
    const set = (kind: 'notification' | 'alarm'): Wanted => ({
      kind,
      endsAt: NOW + 90_000,
      sessionId: 'session-1',
      ...SAID,
    })
    expect(chimesInApp(null)).toBe(true)
    expect(chimesInApp(set('notification'))).toBe(true)
    expect(chimesInApp(set('alarm'))).toBe(false)
  })

  test('is silent while the alarm rings for the rest just run out', async () => {
    const alerts = alertsOn()
    await alerts.follow(want(running(90), 'alarm'))
    await alerts.follow(want(RUN_OUT, 'alarm'))
    expect(chimesInApp(alerts.current())).toBe(false)
  })

  /** Alarms refused since in iOS Settings, or the alarm never set: the rest still ends out loud. */
  test('plays when the alarm chosen could not be set', async () => {
    const alerts = alertsOn({
      ...aPhone(),
      scheduleAlarm: async () => {
        throw new Error('AlarmKit is not authorized')
      },
    })
    await expect(alerts.follow(want(running(90), 'alarm'))).rejects.toThrow(/authorized/u)
    expect(chimesInApp(alerts.current())).toBe(true)
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

  /** The rest was counted a moment ago; iOS is asked now, and counts from now. */
  test('is counted from when it is set, by the phone’s clock then', async () => {
    const phone = aPhone()
    await alertsOn(phone, { now: () => NOW + sToMs(30) }).follow(want(running(90)))
    expect(phone.asked).toEqual(notified(60))
  })
})

describe('what the phone is asked', () => {
  /** The Lock Screen says the next set, as the notification does; a tap on either opens the session. */
  test('a notification, the rest counting down beside it, each saying the next set', async () => {
    const asked: unknown[] = []
    await alertsOn({
      ...aPhone(),
      showCountdown: async (seconds, next, sessionId) => {
        asked.push({ countdown: { seconds, next, sessionId } })
      },
      scheduleNotification: async (notification) => {
        asked.push({ notification })
      },
    }).follow(want(running(90)))
    expect(asked).toEqual([
      { countdown: { seconds: 90, next: SAID.body, sessionId: 'session-1' } },
      {
        notification: { seconds: 90, ...SAID, data: { sessionId: 'session-1' } },
      },
    ])
  })

  test('an alarm, saying the title alone', async () => {
    const asked: unknown[] = []
    await alertsOn({
      ...aPhone(),
      scheduleAlarm: async (seconds, title) => {
        asked.push([seconds, title])
      },
    }).follow(want(running(90), 'alarm'))
    expect(asked).toEqual([[90, 'Rest over']])
  })

  /** Tapped, from a cold start too: the session it was set for opens. */
  test('a tap on the notification opens the session it was set for, and nothing else does', async () => {
    const set: RestNotification[] = []
    await alertsOn({
      ...aPhone(),
      scheduleNotification: async (notification) => {
        set.push(notification)
      },
    }).follow(want(running(90)))
    expect(sessionTapped(set[0]?.data)).toBe('session-1')
    expect(sessionTapped({})).toBeNull()
    expect(sessionTapped({ sessionId: 3 })).toBeNull()
    expect(sessionTapped('session-1')).toBeNull()
    expect(sessionTapped(null)).toBeNull()
  })
})

describe('what this phone has set', () => {
  test('is the rest’s end, once, however often the clock ticks', async () => {
    const phone = aPhone()
    let clock = NOW
    const alerts = alertsOn(phone, { now: () => clock })
    for (let second = 0; second < 5; second += 1) {
      clock = NOW + sToMs(second)
      // oxlint-disable-next-line no-await-in-loop -- one tick after another, as the clock runs.
      await alerts.follow(want(running(90 - second), 'notification', clock))
    }
    expect(phone.asked).toEqual(notified(90))
  })

  /** +30 s, from this phone or another: the rest ends later, and so does its alert. */
  test('moves when the rest is made longer', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone)
    await alerts.follow(want(running(90)))
    await alerts.follow(want(running(120)))
    expect(phone.asked).toEqual([...notified(90), ...notified(120)])
  })

  /** Skipped, undone, the next set logged, finished or deleted: no rest runs, and nothing tells it. */
  test('is cancelled when the rest stops running', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone)
    await alerts.follow(want(running(90)))
    await alerts.follow(want({ phase: 'over', skipped: true }))
    await alerts.follow(want({ phase: 'none' }))
    expect(phone.asked).toEqual([...notified(90), ...UNNOTIFIED])
  })

  /**
   * The phone sees the rest run out as the alert goes off: cancelling it then would silence an alarm
   * as it starts to ring. The next rest's replaces it.
   */
  test('is left alone when the rest runs out', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone)
    await alerts.follow(want(running(1)))
    await alerts.follow(want(RUN_OUT))
    await alerts.follow(want(running(90)))
    expect(phone.asked).toEqual([...notified(1), ...notified(90)])
  })

  /** Still ringing, an alarm stops when the next set has no rest after it, or the session ends. */
  test('run out, is still cancelled by what ends the rest', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone)
    await alerts.follow(want(running(1), 'alarm'))
    await alerts.follow(want(RUN_OUT, 'alarm'))
    await alerts.follow(want({ phase: 'none' }, 'alarm'))
    await alerts.follow(want(running(1), 'alarm'))
    await alerts.follow(want(RUN_OUT, 'alarm'))
    await alerts.end('session-1')
    expect(phone.asked).toEqual(['alarm in 1s', 'cancel alarm', 'alarm in 1s', 'cancel alarm'])
  })

  /** Finished here, or on another device: no clock runs on a finished session to cancel it. */
  test('is cancelled when its session is finished, and not by another’s', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone)
    await alerts.follow(want(running(90)))
    await alerts.end('session-0')
    expect(phone.asked).toEqual(notified(90))
    await alerts.end('session-1')
    await alerts.end('session-1')
    expect(phone.asked).toEqual([...notified(90), ...UNNOTIFIED])
  })

  /** One kind per rest, never both. */
  test('changes kind by cancelling the one set before setting the other', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone)
    await alerts.follow(want(running(90)))
    await alerts.follow(want(running(90), 'alarm'))
    await alerts.follow(want(running(90), 'off'))
    expect(phone.asked).toEqual([...notified(90), ...UNNOTIFIED, 'alarm in 90s', 'cancel alarm'])
  })

  /** Two changes in a row — a set logged, then +30 s — reach the phone in the order they came. */
  test('follows changes one at a time, in order', async () => {
    const phone = aSlowPhone()
    const alerts = alertsOn(phone.device)
    const first = alerts.follow(want(running(90)))
    const second = alerts.follow(want(running(120)))
    await phone.started
    phone.letGo()
    await Promise.all([first, second])
    expect(phone.asked).toEqual([...notified(90), ...notified(120)])
  })

  /**
   * Opened again, the app has set nothing yet, but iOS may still hold what it set before — a
   * countdown on the Lock Screen, its notification. Cleared, as the kind changes, every kind goes.
   */
  test('cleared, cancels every kind iOS may hold, even from before the app was opened', async () => {
    const phone = aPhone()
    await alertsOn(phone).clear()
    expect(phone.asked).toEqual([...UNNOTIFIED, 'cancel alarm'])
  })

  test('cleared, holds nothing set', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone)
    await alerts.follow(want(running(90)))
    await alerts.clear()
    expect(phone.asked).toEqual([...notified(90), ...UNNOTIFIED, 'cancel alarm'])
    expect(alerts.current()).toBeNull()
  })
})

describe('with the app in front', () => {
  /** The band and the chime have said so: "Rest over" need not wait on the Lock Screen. */
  test('a rest run out ends its countdown at once', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone, { inFront: () => true })
    await alerts.follow(want(running(1)))
    await alerts.follow(want(RUN_OUT))
    expect(phone.asked).toEqual([...notified(1), 'end countdown'])
  })

  /** Each time it is seen run out, and told as an alarm too, whose countdown is iOS's own. */
  test('a rest run out ends its countdown however it is told, as often as it is seen', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone, { inFront: () => true })
    await alerts.follow(want(running(1), 'alarm'))
    await alerts.follow(want(RUN_OUT, 'alarm'))
    await alerts.follow(want(RUN_OUT, 'alarm'))
    expect(phone.asked).toEqual(['alarm in 1s', 'end countdown', 'end countdown'])
  })

  /** Seen to run out in front, its countdown goes, though the app is closed by the time it can. */
  test('is as the rest is seen to run out, not when its turn comes', async () => {
    const phone = aSlowPhone()
    let front = true
    const alerts = alertsOn(phone.device, { inFront: () => front })
    const first = alerts.follow(want(running(1)))
    await phone.started
    const told = alerts.follow(want(RUN_OUT))
    front = false
    phone.letGo()
    await Promise.all([first, told])
    expect(phone.asked).toEqual([...notified(1), 'end countdown'])
  })

  /** Closed, nobody has seen it: the countdown says "Rest over" until the app is back. */
  test('closed, a rest run out leaves its countdown', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone, { inFront: () => false })
    await alerts.follow(want(running(1)))
    await alerts.follow(want(RUN_OUT))
    expect(phone.asked).toEqual(notified(1))
  })

  /**
   * Back in front, the app says what was told while it was closed: the notification shown goes, and
   * a countdown whose rest is over. One still counting, and an alarm, are left as they are.
   */
  test('back, clears what was shown while it was closed, and leaves what is set', async () => {
    const phone = aPhone()
    const alerts = alertsOn(phone)
    await alerts.follow(want(running(90), 'alarm'))
    await alerts.cameToFront()
    expect(phone.asked).toEqual(['alarm in 90s', 'dismiss notification', 'end countdown if over'])
    expect(alerts.current()?.kind).toBe('alarm')
  })
})
