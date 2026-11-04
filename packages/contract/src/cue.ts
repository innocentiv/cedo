import { z } from 'zod'

/**
 * What a plan entry tells the athlete beyond its numbers, in a line — "pause 1 s at the chest" —
 * written by whoever wrote the plan, a coach or an AI, and shown under the exercise as they log it.
 */

export const MAX_CUE_LENGTH = 200

/**
 * Text kept to one line: every run of whitespace — a newline from a paste or an AI included — one
 * space. What a cue is kept as, and what its field shows as it is typed (#51).
 */
export function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, ' ')
}

/** One line, whoever wrote it (`oneLine`), before it is measured. Trimmed; blank is none. */
export const EntryCue = z
  .string()
  .overwrite(oneLine)
  .trim()
  .max(MAX_CUE_LENGTH, `A cue is at most ${MAX_CUE_LENGTH} characters`)
  .nullable()
  .transform((cue) => (cue === '' ? null : cue))
