import { type RestAlert, type RestPhase, msToS, sToMs } from '@cedo/contract'
import { type AlertKind, TELLING_KINDS, type TellingKind } from './rest-alert-kind.ts'

/**
 * What this phone has set to tell the end of a rest with the app closed (#39), and every rule about
 * it — outside React, so each is unit-tested with a fake phone (rest-alert.test.ts), as the
 * session is with a fake keychain: which of the phone's calls each change makes, and in what order.
 *
 * The phone that logged the set tells it, and nothing else does: no push, no server (ADR-0032). The
 * alert follows the rest this phone counts (`restPhase`), so every change to it — a set logged,
 * +30 s here or on another device, a skip, an undo, the next set, finishing — reaches the alert by
 * the one road, the rest's own clock: the end moves, or no rest runs and it is cancelled.
 */

/** An alert to be told: when, by this phone's clock, and what it says. */
export interface Wanted {
  readonly kind: TellingKind
  readonly endsAt: number
  readonly title: string
  readonly body: string
  /** The session a tap on it opens. */
  readonly sessionId: string
}

/**
 * A rest that has run out has been told: its alert is ringing, or shown. It is left, not cancelled
 * as it starts — the phone sees the rest end as the alert goes off — and kept as set, so the next
 * rest's replaces it, and what ends the rest still cancels it: a still-ringing alarm stops when the
 * next set has no rest after it, or the session is finished.
 */
export type Told = 'told'

/**
 * The alert the rest now running wants, if any: at its end, counted from what the phone counts —
 * `left` seconds from now — never from the server's end read by the phone's clock, which would
 * carry their skew (CLAUDE.md). None when skipped, undone, or no rest follows the set.
 */
export function wantedAlert({
  kind,
  phase,
  said,
  sessionId,
  now,
}: {
  readonly kind: AlertKind
  readonly phase: RestPhase
  readonly said: RestAlert
  readonly sessionId: string
  readonly now: number
}): Wanted | Told | null {
  if (kind === 'off') return null
  if (phase.phase === 'over' && !phase.skipped) return 'told'
  if (phase.phase !== 'running') return null
  return { kind, endsAt: now + sToMs(phase.left), sessionId, ...said }
}

/** Whole seconds to an end, by this phone's clock — never none: iOS refuses an alert due now. */
export const secondsUntil = (endsAt: number, now: number): number =>
  Math.max(1, Math.round(msToS(endsAt - now)))

/**
 * The app's own chime at a rest's end, unless an alarm is set for it, which rings even with the app
 * in front. Set, not chosen: an alarm iOS refused since, or never set, leaves the rest silent else.
 */
export const chimesInApp = (set: Wanted | null): boolean => set?.kind !== 'alarm'

/** A rest's notification, as iOS is asked to tell it. */
export interface NotificationAsked {
  readonly seconds: number
  readonly title: string
  readonly body: string
  /** What a tap on it carries back to the app: the session it opens (`sessionTapped`). */
  readonly data: { readonly sessionId: string }
}

/**
 * What the phone offers to tell a rest's end, one call each — `expo-notifications` and the app's own
 * native module (rest-alert-device.ts), or a fake. Which are asked, and in what order, is decided here.
 */
export interface AlertDevice {
  /** The rest counting down on the Lock Screen and in the Dynamic Island; shown again, replaced. */
  readonly showCountdown: (seconds: number, next: string, sessionId: string) => Promise<void>
  readonly endCountdown: () => Promise<void>
  /** Ended only if its rest is over: one still counting stays. */
  readonly endCountdownIfOver: () => Promise<void>
  /** The one rest notification: scheduled again, it replaces the one pending. */
  readonly scheduleNotification: (asked: NotificationAsked) => Promise<void>
  /** The one pending, not told yet. */
  readonly cancelNotification: () => Promise<void>
  /** The one told, still shown. */
  readonly dismissNotification: () => Promise<void>
  /** The one alarm: scheduled again, it replaces the one pending. */
  readonly scheduleAlarm: (seconds: number, title: string) => Promise<void>
  readonly cancelAlarm: () => Promise<void>
}

/** How a kind is set and cancelled, in the phone's own calls. */
interface Teller {
  readonly schedule: (device: AlertDevice, wanted: Wanted, seconds: number) => Promise<void>
  readonly cancel: (device: AlertDevice) => Promise<void>
}

const TELLERS: Readonly<Record<TellingKind, Teller>> = {
  notification: {
    schedule: async (device, { title, body, sessionId }, seconds) => {
      // The rest counting down beside it, from now: started as the set is logged, in front.
      await device.showCountdown(seconds, body, sessionId)
      await device.scheduleNotification({ seconds, title, body, data: { sessionId } })
    },
    cancel: async (device) => {
      await device.cancelNotification()
      // One told while the app was closed tells a rest that is over now.
      await device.dismissNotification()
      await device.endCountdown()
    },
  },
  alarm: {
    // cedo's chime, again until stopped, and the title alone: an alarm says no more.
    schedule: async (device, { title }, seconds) => {
      await device.scheduleAlarm(seconds, title)
    },
    cancel: async (device) => {
      await device.cancelAlarm()
    },
  },
}

/** The session a tap on a rest's notification opens — none for anything else tapped. */
export function sessionTapped(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('sessionId' in data)) return null
  return typeof data.sessionId === 'string' ? data.sessionId : null
}

/**
 * Within this, an end counted a second earlier or later is the same end: `left` is counted in whole
 * seconds, so the end it gives moves by up to one as the clock ticks.
 */
const SAME_END_MS = 1500

const same = (a: Wanted | null, b: Wanted | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.kind === b.kind &&
    a.sessionId === b.sessionId &&
    a.title === b.title &&
    a.body === b.body &&
    Math.abs(a.endsAt - b.endsAt) < SAME_END_MS)

/**
 * One change at a time, in the order they came — a set logged, then +30 s, reach the phone so —
 * each read in turn from what is set by then.
 */
function inOrder(): (change: () => Promise<void>) => Promise<void> {
  let queue: Promise<void> = Promise.resolve()
  return async (change) => {
    const before = queue
    const mine = (async () => {
      // A change that failed before this one does not stop it: it is what the rest wants now.
      await before.catch(() => null)
      await change()
    })()
    queue = mine
    await mine
  }
}

export interface RestAlerts {
  /** Whatever the rest now wants — called as its clock runs; changes only what changed. */
  readonly follow: (wanted: Wanted | Told | null) => Promise<void>
  /** What iOS has set: for the rest running, or the one just run out — none if setting it failed. */
  readonly current: () => Wanted | null
  /**
   * Every kind cancelled, whatever this open of the app has set: iOS keeps what an earlier one set
   * — a countdown, a notification — which nothing here remembers.
   */
  readonly clear: () => Promise<void>
  /**
   * A session finished — here or on another device — has no rest to tell: its alert is cancelled,
   * though no clock runs to say so. Another session's is left.
   */
  readonly end: (sessionId: string) => Promise<void>
  /**
   * The app back in front, or opened: the notification shown while it was closed, and a countdown
   * turned "Rest over", tell a rest the app now says is over, and go. An alarm, and a countdown
   * still running, stay.
   */
  readonly cameToFront: () => Promise<void>
}

interface RestAlertsOn {
  readonly device: AlertDevice
  /** This phone's clock, epoch ms: what an alert's seconds to go are counted by. */
  readonly now: () => number
  /** Whether the app is in front, and seen. */
  readonly inFront: () => boolean
}

export function createRestAlerts({ device, now, inFront }: RestAlertsOn): RestAlerts {
  let set: Wanted | null = null
  const inTurn = inOrder()
  const apply = async (wanted: Wanted | Told | null): Promise<void> => {
    if (wanted === 'told' || same(set, wanted)) return
    if (set !== null && set.kind !== wanted?.kind) await TELLERS[set.kind].cancel(device)
    if (wanted !== null) {
      await TELLERS[wanted.kind].schedule(device, wanted, secondsUntil(wanted.endsAt, now()))
    }
    set = wanted
  }
  return {
    follow: async (wanted) => {
      // In front as the rest is seen to run out, not whenever this change's turn comes.
      const toldInFront = wanted === 'told' && inFront()
      await inTurn(async () => {
        // Run out with the app in front, the band and the chime have said so: its countdown goes
        // now, rather than waiting as "Rest over" on the Lock Screen for whenever it is locked.
        if (toldInFront) await device.endCountdown()
        await apply(wanted)
      })
    },
    end: async (sessionId) => {
      await inTurn(async () => {
        await apply(set?.sessionId === sessionId ? null : set)
      })
    },
    current: () => set,
    clear: async () => {
      await inTurn(async () => {
        set = null
        for (const kind of TELLING_KINDS) {
          // oxlint-disable-next-line no-await-in-loop -- one kind after the other, as iOS is asked.
          await TELLERS[kind].cancel(device)
        }
      })
    },
    cameToFront: async () => {
      await inTurn(async () => {
        await device.dismissNotification()
        await device.endCountdownIfOver()
      })
    },
  }
}
