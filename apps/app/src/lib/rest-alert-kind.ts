import type { TokenStore } from '../auth/session.ts'
import { observed } from './observed.ts'

/**
 * How this phone tells a rest's end with the app closed (#39) — off, a notification or an alarm —
 * and every rule about choosing it: the phone's own choice, kept in its keychain, outside React,
 * unit-tested beside what is set for a rest (rest-alert.test.ts, rest-alert.ts).
 */

/** How this phone is told a rest is over: kept on the phone, which alone knows what it allows. */
const ALERT_KINDS = ['off', 'notification', 'alarm'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

/** A kind that tells: what iOS is asked to allow, and what an alert is set as. */
export type TellingKind = Exclude<AlertKind, 'off'>
export const TELLING_KINDS: readonly TellingKind[] = ['notification', 'alarm']

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
 * person once and after that answers what they said. Changed — turned off too — every kind iOS
 * holds is cleared at once: a rest whose screen is not open is not followed (`RestAlerts`), and the
 * rest's screen sets the new kind's as it follows the rest again.
 */
export function createAlertKind({
  store,
  allow,
  alerts,
}: {
  readonly store: AlertKindStore
  readonly allow: (kind: TellingKind) => Promise<boolean>
  /** What this phone has set (`RestAlerts`, rest-alert.ts): cleared as the kind changes. */
  readonly alerts: { readonly clear: () => Promise<void> }
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
      // Before the kind is heard, so the rest's screen sets the new one after the old is gone.
      await alerts.clear()
      state.set(kind)
      return true
    },
  }
}
