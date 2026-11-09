import type { RestPhase } from '@cedo/contract'

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

/** The kind kept on the phone, or off when none — or something no longer offered — is. */
export const kindOf = (kept: string | null): AlertKind =>
  ALERT_KINDS.find((kind) => kind === kept) ?? 'off'

/** An alert to be told: when, by this phone's clock, and what it says. */
export interface Wanted {
  readonly kind: 'notification' | 'alarm'
  readonly endsAt: number
  readonly title: string
  readonly body: string
  /** The session a tap on it opens. */
  readonly sessionId: string
}

/**
 * The alert the rest now running wants, if any: at its end, counted from what the phone counts —
 * `left` seconds from now — never from the server's end read by the phone's clock, which would
 * carry their skew (CLAUDE.md).
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
  readonly said: { readonly title: string; readonly body: string }
  readonly sessionId: string
  readonly now: number
}): Wanted | null {
  if (kind === 'off' || phase.phase !== 'running') return null
  return { kind, endsAt: now + phase.left * 1000, sessionId, ...said }
}

/** The app's own chime at a rest's end, unless an alarm will ring for it — even with the app in front. */
export const chimesInApp = (kind: AlertKind): boolean => kind !== 'alarm'

/** What tells the phone: `expo-notifications`, or the alarm module — or a fake. */
export interface AlertScheduler {
  /** One alert of a kind at a time: setting one replaces the one before. */
  readonly schedule: (wanted: Wanted) => Promise<void>
  readonly cancel: (kind: Wanted['kind']) => Promise<void>
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
  readonly follow: (wanted: Wanted | null) => Promise<void>
}

export function createRestAlerts(scheduler: AlertScheduler): RestAlerts {
  let set: Wanted | null = null
  // One change at a time, in the order they came: a set logged, then +30 s, reach the phone so.
  let queue: Promise<void> = Promise.resolve()
  const apply = async (wanted: Wanted | null): Promise<void> => {
    if (same(set, wanted)) return
    if (set !== null && set.kind !== wanted?.kind) await scheduler.cancel(set.kind)
    if (wanted !== null) await scheduler.schedule(wanted)
    set = wanted
  }
  return {
    follow: async (wanted) => {
      const before = queue
      const mine = (async () => {
        // A change that failed before this one does not stop it: it is what the rest wants now.
        await before.catch(() => null)
        await apply(wanted)
      })()
      queue = mine
      await mine
    },
  }
}
