import { z } from 'zod'

/**
 * What a plan entry tells the athlete beyond its numbers: the rest between its working sets, and a
 * cue — "pause 1 s at the chest" — from whoever wrote the plan, a coach or an AI.
 */

export const MAX_CUE_LENGTH = 200

/** One line for the athlete, shown under the exercise as they log it. Blank is none. */
export const EntryCue = z
  .string()
  .trim()
  .max(MAX_CUE_LENGTH, `A cue is at most ${MAX_CUE_LENGTH} characters`)
  .nullable()
  .transform((cue) => (cue === '' ? null : cue))

/**
 * Seconds of the entry's rest still to go, counted from its latest WORKING set — a warm-up is the
 * ramp to the work, not what the rest is for — in whole seconds, rounding up, so it reads 0 only
 * once the rest is over. Null before the first working set, or with no rest prescribed.
 *
 * From when the server logged the set, not from a tap: a reload, or another screen, counts the
 * same rest. The server's clock and the device's disagree — by a moment under NTP, more inside a
 * container's VM — so a set can look logged in the future: the rest left is never more than the
 * rest prescribed.
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
  if (entry.restSeconds === null) return null
  const latest = logs
    .filter((l) => l.entryId === entry.id && !l.isWarmup)
    .reduce<number | null>((at, l) => Math.max(at ?? 0, Date.parse(l.loggedAt)), null)
  if (latest === null) return null
  const left = Math.ceil(entry.restSeconds - (now - latest) / 1000)
  return Math.min(entry.restSeconds, Math.max(0, left))
}
