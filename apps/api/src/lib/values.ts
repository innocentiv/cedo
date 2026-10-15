import { type SQL, sql } from 'drizzle-orm'

/**
 * `(…), (…)` for a VALUES list. Every cell is a bound parameter — Postgres types them as text, so
 * each column is cast where it is used.
 */
export function valuesOf(rows: readonly (readonly (string | number | null)[])[]): SQL {
  return sql.join(
    rows.map(
      (row) =>
        sql`(${sql.join(
          row.map((cell) => sql`${cell === null ? null : String(cell)}`),
          sql`, `,
        )})`,
    ),
    sql`, `,
  )
}
