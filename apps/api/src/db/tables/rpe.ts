import { type SQL, sql } from 'drizzle-orm'
import { type AnyPgColumn, customType } from 'drizzle-orm/pg-core'
import { RPE_MAX, RPE_MIN, reserveOf, rpeOf } from '@cedo/contract'

/**
 * Reps in reserve, on a prescribed set and on a logged one, STORED as RPE — 5 to 10, whole
 * (ADR-0027): one column shape and one check, so the two cannot drift.
 *
 * The column is the one place the RPE scale survives. It converts at the driver, both ways
 * (`rpeOf`, `reserveOf`, the contract's), so every row the API reads already says reps in reserve
 * and nothing above this file holds an RPE. NULL is not converted: not said stays not said.
 *
 * ONLY what passes the column's encoder converts. SQL that computes on the column — `avg()`, a
 * comparison against a literal, `${col} * 2` in raw `sql` — sees the stored RPE, with no error to
 * say so: a mean of 8 there is 2 in reserve, and `> 8` means "fewer than 2 left". Read the column
 * as a value and do the arithmetic in TypeScript, as the review and progression do; a raw write
 * that means to store an RPE (a seed, a test of the check) does so on purpose.
 *
 * A rating, not a measurement, so not an integer in base units (invariant 6 is for measurements):
 * `numeric(3,1)`, exact (ADR-0020). The check holds the scale again, for a write that does not pass
 * through the contract — a migration, a seed.
 */
export const reserveColumn = customType<{ data: number; driverData: string | number }>({
  dataType: () => 'numeric(3, 1)',
  toDriver: (reserve) => rpeOf(reserve),
  fromDriver: (rpe) => reserveOf(Number(rpe)),
})

/** The stored scale, as literals: a CHECK cannot take parameters. Whole: no half is stored. */
const [min, max] = [RPE_MIN, RPE_MAX].map((n) => sql.raw(String(n)))

export const rpeCheck = (column: AnyPgColumn): SQL =>
  sql`${column} is null or (${column} between ${min} and ${max} and ${column} = trunc(${column}))`
