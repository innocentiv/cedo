import { z } from 'zod'

/**
 * The five measurement dimensions, declared ONCE.
 *
 * Every bound here must fit Postgres `integer` (max 2_147_483_647), because these back `int4`
 * columns. A value that passes validation and then overflows the column surfaces as an unhandled
 * 500, so the contract is what keeps the database in range.
 *
 * Declared here once rather than per module. Spelled out separately in progression.ts, workout.ts
 * and log.ts they drift, and the shape that drifts first is history — validating more loosely than
 * the log rows it is read from.
 */

/** 2 tonnes. Beyond any human lift, any machine stack, and any loaded sled. */
export const MAX_WEIGHT_G = 2_000_000
export const MAX_REPS = 1000
/** 24 hours. */
export const MAX_DURATION_S = 86_400
/** 1000 km. */
export const MAX_DISTANCE_MM = 1_000_000_000

/** Logged values allow zero: a set you failed is still a set that happened. */
export const LoggedReps = z.int().nonnegative().max(MAX_REPS)
export const LoggedWeightG = z.int().nonnegative().max(MAX_WEIGHT_G)
export const LoggedDurationS = z.int().nonnegative().max(MAX_DURATION_S)
export const LoggedDistanceMm = z.int().nonnegative().max(MAX_DISTANCE_MM)

/** Prescribed values must be meaningful: a target of zero reps is not a prescription. */
const MORE_THAN_ZERO = 'Must be more than 0'
const TOO_LARGE = 'Too large'
export const TargetReps = z.int().positive(MORE_THAN_ZERO).max(MAX_REPS, TOO_LARGE)
export const TargetWeightG = z.int().nonnegative('Cannot be negative').max(MAX_WEIGHT_G, TOO_LARGE)
export const TargetDurationS = z.int().positive(MORE_THAN_ZERO).max(MAX_DURATION_S, TOO_LARGE)
export const TargetDistanceMm = z.int().positive(MORE_THAN_ZERO).max(MAX_DISTANCE_MM, TOO_LARGE)
