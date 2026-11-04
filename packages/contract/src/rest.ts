import { z } from 'zod'
import { Timestamp } from './primitives.ts'
import { formatDuration } from './units.ts'

/**
 * The rest a plan entry prescribes between its working sets, and what the logger counts down.
 *
 * Two minutes unless the plan says otherwise: the evidence leans, with wide uncertainty, toward
 * longer rest for growth, and a minute or less on a compound lift is a known pitfall (Singer et al.,
 * Front Sports Act Living 2024). A rest of 0 — or null — is "straight on". A superset rests after
 * the round, never within it, whatever its earlier entries say (`restingAfter`): the rest is that
 * of the entry that ends the round — its last, or an earlier one once the entries after it have no
 * sets left (#48).
 */

export const DEFAULT_REST_S = 120

/**
 * Where an entry sits for its rest (#48): out of a superset — or alone on its letter, which makes
 * no round — `own`; a superset's `last` entry, in the day's order; or an `earlier` one.
 */
export type RestPlace = 'own' | 'last' | 'earlier'

/**
 * Where the entry `at` sits for its rest, by the day's order. A `last` entry's rest runs after each
 * round; an `earlier` one's only when it ends the round — once the entries after it have no sets
 * left — as between partners the round runs straight on. `restingAfter` is what keeps it.
 */
export function restPlace(
  entries: readonly { readonly supersetGroup: string | null }[],
  at: number,
): RestPlace {
  const letter = entries[at]?.supersetGroup ?? null
  if (letter === null) return 'own'
  const partners = entries.flatMap((e, i) => (i !== at && e.supersetGroup === letter ? [i] : []))
  if (partners.length === 0) return 'own'
  return partners.some((i) => i > at) ? 'earlier' : 'last'
}

/** An entry's rest as a plan says it, alike to the AI and in the app: `rest 1:30 after the round`. */
export function restWords(restSeconds: number | null, place: RestPlace): string {
  if (restSeconds === null || restSeconds === 0) return 'straight on'
  const rest = `rest ${formatDuration(restSeconds)}`
  if (place === 'last') return `${rest} after the round`
  return place === 'earlier' ? `${rest} when it ends the round` : rest
}

/** `Rest 1:30 after the round`: `restWords` opening a line of its own, as the app shows it. */
export function restTitle(restSeconds: number | null, place: RestPlace): string {
  const words = restWords(restSeconds, place)
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/**
 * What the editor says beside an earlier superset entry's rest: when it counts. Nothing for one with
 * no rest, nor out of a superset, nor on its last entry — there the rest says itself.
 */
export function restNote(restSeconds: number | null, place: RestPlace): string | null {
  if (place !== 'earlier' || restSeconds === null || restSeconds === 0) return null
  return 'Counts only when this entry ends the round, once the entries after it have no sets left. Between partners the round runs straight on.'
}

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

/**
 * The rest a session has running, as the server keeps it (#38): from the set it follows, to when it
 * ends — +30 s included. Skipped, it ends when it began. What the countdown counts to, on every
 * device.
 */
export const SessionRest = z.object({ since: Timestamp, endsAt: Timestamp })
export type SessionRest = z.output<typeof SessionRest>

/**
 * `POST /sessions/:id/rest`: +30 s, or skip — of the rest running after the session's `sets`th set.
 * Named by how many sets there were when it was tapped, never by a time: a set waiting for a signal
 * is dated by the phone, then by the server. A change after the next set changes nothing.
 */
export const RestChange = z.strictObject({
  sets: z.int().nonnegative(),
  change: z.enum(['extend', 'skip']),
})
export type RestChange = z.output<typeof RestChange>

/**
 * The rest the countdown counts (#38): the one the sets say (`restOf`) with this device's +30 s
 * taps, or — when it is the same rest — as long as the server keeps it, whichever is longer: a tap
 * on another device, or one made before a reload, is the server's to know. Never the two added: a
 * tap here is sent there too.
 */
export function restCounted(
  counted: Rest,
  extensions: number,
  kept: SessionRest | null,
): Rest | null {
  const here = counted.seconds + extensions * REST_EXTENSION_S
  const same = kept !== null && Date.parse(kept.since) === Date.parse(counted.since)
  const there = same ? Math.round((Date.parse(kept.endsAt) - Date.parse(kept.since)) / 1000) : null
  // Ending when it began, it was skipped — here before a reload, or on another device.
  if (there === 0) return null
  return { since: counted.since, seconds: Math.max(here, there ?? 0) }
}

/**
 * Where the rest after the latest set stands (#63) — what the workout shows in Log's place: none
 * follows the set (a warm-up, a superset's first, a rest of 0), it runs with so much left, or it is
 * over — run out, or skipped here or on another device: only a rest run out ends with the chime.
 * While it runs, or when none follows, the set just logged can still be undone where it was logged;
 * once it is over, it is fixed in the list.
 */
export type RestPhase =
  | { readonly phase: 'none' }
  | { readonly phase: 'running'; readonly left: number }
  | { readonly phase: 'over'; readonly skipped: boolean }

/**
 * The rest after the latest set — the sets' (`restOf`), with this device's +30 s taps and skip, and
 * as the server keeps it (`restCounted`) — as it stands `now`.
 */
export function restPhase(
  rest: Rest | null,
  extensions: number,
  kept: SessionRest | null,
  skipped: boolean,
  now: number,
): RestPhase {
  if (rest === null) return { phase: 'none' }
  const counted = skipped ? null : restCounted(rest, extensions, kept)
  if (counted === null) return { phase: 'over', skipped: true }
  const left = restRemaining(counted, 0, now)
  return left > 0 ? { phase: 'running', left } : { phase: 'over', skipped: false }
}

/**
 * Whether a rest's end chimes (#24, #63): the rest seen running — named by how many sets it follows
 * — has run out. Never one skipped, one opened already over, nor an earlier rest an undo took the
 * session back to: those are not the rest the athlete was waiting on.
 */
export function chimesAtEnd(
  seenRunning: number | null,
  restAfter: number | null,
  phase: RestPhase,
): boolean {
  return (
    phase.phase === 'over' && !phase.skipped && seenRunning !== null && seenRunning === restAfter
  )
}
