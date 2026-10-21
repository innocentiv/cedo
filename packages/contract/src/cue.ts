import { z } from 'zod'

/**
 * What a plan entry tells the athlete beyond its numbers, in a line — "pause 1 s at the chest" —
 * written by whoever wrote the plan, a coach or an AI, and shown under the exercise as they log it.
 */

export const MAX_CUE_LENGTH = 200

/** Trimmed; blank is none. */
export const EntryCue = z
  .string()
  .trim()
  .max(MAX_CUE_LENGTH, `A cue is at most ${MAX_CUE_LENGTH} characters`)
  .nullable()
  .transform((cue) => (cue === '' ? null : cue))
