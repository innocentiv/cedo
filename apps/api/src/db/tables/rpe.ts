import { type SQL, sql } from 'drizzle-orm'
import { type AnyPgColumn, numeric } from 'drizzle-orm/pg-core'
import { RPE_MAX, RPE_MIN, RPE_STEP } from '@cedo/contract'

/**
 * Reps in reserve, stored as RPE — 5 to 10, whole (ADR-0027) — on a prescribed set and on a logged
 * one: one column shape and one check, so the two cannot drift.
 *
 * A rating, not a measurement, so not an integer in base units (invariant 6 is for measurements):
 * `numeric(3,1)`, read as a number. The check holds the contract's `Rpe` again, for a write that
 * does not pass through it — a migration, a seed.
 */
export const rpeColumn = (name: string) => numeric(name, { precision: 3, scale: 1, mode: 'number' })

/** The contract's scale, as literals: a CHECK cannot take parameters. */
const [min, max, steps] = [RPE_MIN, RPE_MAX, 1 / RPE_STEP].map((n) => sql.raw(String(n)))

export const rpeCheck = (column: AnyPgColumn): SQL =>
  sql`${column} is null or (${column} between ${min} and ${max} and ${column} * ${steps} = trunc(${column} * ${steps}))`
