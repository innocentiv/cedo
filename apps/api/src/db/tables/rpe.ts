import { type SQL, sql } from 'drizzle-orm'
import { type AnyPgColumn, numeric } from 'drizzle-orm/pg-core'

/**
 * RPE, as GLOSSARY.md defines it — 5 to 10 in half-points — on a prescribed set and on a logged
 * one: one column shape and one check, so the two cannot drift.
 *
 * A rating, not a measurement, so not an integer in base units (invariant 6 is for measurements):
 * `numeric(3,1)`, read as a number. The check holds the contract's `Rpe` again, for a write that
 * does not pass through it — a migration, a seed.
 */
export const rpeColumn = (name: string) => numeric(name, { precision: 3, scale: 1, mode: 'number' })

export const rpeCheck = (column: AnyPgColumn): SQL =>
  sql`${column} is null or (${column} between 5 and 10 and ${column} * 2 = trunc(${column} * 2))`
