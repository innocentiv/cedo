/**
 * The rest a plan entry prescribes between its working sets, and what the logger counts down.
 *
 * Two minutes unless the plan says otherwise: the evidence leans, with wide uncertainty, toward
 * longer rest for growth, and a minute or less on a compound lift is a known pitfall (Singer et al.,
 * Front Sports Act Living 2024). A rest of 0 is "straight on": in a superset, the rest goes on its
 * last exercise and the others' 0 sends the athlete straight to the next.
 */

export const DEFAULT_REST_S = 120

/**
 * Seconds of the entry's rest still to go, counted from its latest WORKING set — a warm-up is the
 * ramp to the work, not what the rest is for — in whole seconds, rounding up, so it reads 0 only
 * once the rest is over. Null before the first working set, or with no rest prescribed (0 too).
 *
 * From when the server logged the set, not from a tap: a reload, or another screen, counts the
 * same rest. The server's clock and the device's disagree — by a moment under NTP, more inside a
 * container's VM. A server clock AHEAD makes a set look logged in the future: the rest left is
 * never more than the rest prescribed. One BEHIND shortens the rest by the difference, which
 * nothing here can see.
 */
export function restLeft(
  logs: readonly {
    readonly entryId: string | null
    readonly loggedAt: string
    readonly isWarmup: boolean
  }[],
  entry: { readonly id: string; readonly restSeconds: number | null },
  now: number,
): number | null {
  if (entry.restSeconds === null || entry.restSeconds === 0) return null
  const latest = logs
    .filter((l) => l.entryId === entry.id && !l.isWarmup)
    .reduce<number | null>((at, l) => Math.max(at ?? 0, Date.parse(l.loggedAt)), null)
  if (latest === null) return null
  const left = Math.ceil(entry.restSeconds - (now - latest) / 1000)
  return Math.min(entry.restSeconds, Math.max(0, left))
}

/** A rest that is running: when the set it follows was logged, and how long it is. */
export interface Rest {
  readonly since: string
  readonly seconds: number
}

/** What "+30 s" adds to a rest. */
export const REST_EXTENSION_S = 30

/**
 * Seconds of `rest` still to go, extended `extensions` times by `REST_EXTENSION_S` — in whole
 * seconds rounding up, never below zero, and never more than the rest itself: a server clock ahead
 * of the device would otherwise date the set in the future (see `restLeft`).
 */
export function restRemaining(rest: Rest, extensions: number, now: number): number {
  const seconds = rest.seconds + extensions * REST_EXTENSION_S
  const left = Math.ceil(seconds - (now - Date.parse(rest.since)) / 1000)
  return Math.min(seconds, Math.max(0, left))
}
