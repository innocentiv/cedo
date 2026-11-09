import type { RestAlert, RestPhase } from '@cedo/contract'
import type { TokenStore } from '../auth/session.ts'
import { observed } from './observed.ts'

/**
 * What this phone has set to tell the end of a rest with the app closed (#39), and every rule about
 * it — outside React, so each is unit-tested with a fake scheduler (rest-alert.test.ts), as the
 * session is with a fake keychain.
 *
 * The phone that logged the set tells it, and nothing else does: no push, no server (ADR-0032). The
 * alert follows the rest this phone counts (`restPhase`), so every change to it — a set logged,
 * +30 s here or on another device, a skip, an undo, the next set, finishing — reaches the alert by
 * the one road, the rest's own clock: the end moves, or no rest runs and it is cancelled.
 */

/** How this phone is told a rest is over: kept on the phone, which alone knows what it allows. */
export const ALERT_KINDS = ['off', 'notification', 'alarm'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

/** A kind that tells: what iOS is asked to allow, and what an alert is set as. */
export type TellingKind = Exclude<AlertKind, 'off'>

/** The kind kept on the phone, or off when none — or something no longer offered — is. */
export const kindOf = (kept: string | null): AlertKind =>
  ALERT_KINDS.find((kind) => kind === kept) ?? 'off'

/** "Tell me when rest is over", on the rest band: offered while nothing tells this phone. */
export const offersToTell = (kind: AlertKind): boolean => kind === 'off'

/** Where the kind is kept between launches: the keychain, as the sign-in is. */
export type AlertKindStore = TokenStore

export interface AlertKindChoice {
  /** The same value until it changes — for `useSyncExternalStore`. */
  readonly snapshot: () => AlertKind
  readonly subscribe: (listener: () => void) => () => void
  /** At startup: the kind kept. Off until it is read, and when it cannot be. */
  readonly restore: () => Promise<void>
  /** Chosen in Settings, or from the rest band. False when iOS refused it: nothing is kept then. */
  readonly choose: (kind: AlertKind) => Promise<boolean>
}

/**
 * How this phone tells a rest's end: a phone's own choice. iOS is asked first, as it asks the
 * person once and after that answers what they said. Turned off, what was set is cancelled at once:
 * a rest whose screen is not open is not followed (`RestAlerts`).
 */
export function createAlertKind({
  store,
  allow,
  alerts,
}: {
  readonly store: AlertKindStore
  readonly allow: (kind: TellingKind) => Promise<boolean>
  readonly alerts: RestAlerts
}): AlertKindChoice {
  const state = observed<AlertKind>('off')
  return {
    snapshot: state.get,
    subscribe: state.subscribe,
    restore: async () => {
      const kept = await store.read().catch((error: unknown) => {
        console.error(error)
        return null
      })
      state.set(kindOf(kept))
    },
    choose: async (kind) => {
      if (kind !== 'off' && !(await allow(kind))) return false
      await store.write(kind)
      state.set(kind)
      if (kind === 'off') await alerts.follow(null)
      return true
    },
  }
}

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
 * A rest that has run out has been told: its alert is ringing, or shown. It is left, never
 * cancelled — the phone sees the rest end as the alert goes off, and cancelling then would silence
 * an alarm as it starts — and the next rest's replaces it.
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
  return { kind, endsAt: now + phase.left * 1000, sessionId, ...said }
}

/** Whole seconds to an end, by this phone's clock — never none: iOS refuses an alert due now. */
export const secondsUntil = (endsAt: number, now: number): number =>
  Math.max(1, Math.round((endsAt - now) / 1000))

/** The app's own chime at a rest's end, unless an alarm will ring for it — even with the app in front. */
export const chimesInApp = (kind: AlertKind): boolean => kind !== 'alarm'

/** What tells the phone: `expo-notifications`, or the alarm module — or a fake. */
export interface AlertScheduler {
  /** One alert of a kind at a time: setting one replaces the one before. */
  readonly schedule: (wanted: Wanted) => Promise<void>
  readonly cancel: (kind: TellingKind) => Promise<void>
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

export interface RestAlerts {
  /** Whatever the rest now wants — called as its clock runs; changes only what changed. */
  readonly follow: (wanted: Wanted | Told | null) => Promise<void>
  /**
   * A session finished — here or on another device — has no rest to tell: its alert is cancelled,
   * though no clock runs to say so. Another session's is left.
   */
  readonly end: (sessionId: string) => Promise<void>
}

export function createRestAlerts(scheduler: AlertScheduler): RestAlerts {
  let set: Wanted | null = null
  // One change at a time, in the order they came: a set logged, then +30 s, reach the phone so.
  let queue: Promise<void> = Promise.resolve()
  const apply = async (wanted: Wanted | Told | null): Promise<void> => {
    if (wanted === 'told') {
      set = null
      return
    }
    if (same(set, wanted)) return
    if (set !== null && set.kind !== wanted?.kind) await scheduler.cancel(set.kind)
    if (wanted !== null) await scheduler.schedule(wanted)
    set = wanted
  }
  /** `next` is read in turn, from what is set by then. */
  const after = async (next: () => Wanted | Told | null): Promise<void> => {
    const before = queue
    const mine = (async () => {
      // A change that failed before this one does not stop it: it is what the rest wants now.
      await before.catch(() => null)
      await apply(next())
    })()
    queue = mine
    await mine
  }
  return {
    follow: async (wanted) => {
      await after(() => wanted)
    },
    end: async (sessionId) => {
      await after(() => (set?.sessionId === sessionId ? null : set))
    },
  }
}
