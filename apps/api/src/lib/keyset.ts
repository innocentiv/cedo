import { z } from 'zod'

/**
 * Keyset pagination helpers, shared by every list endpoint.
 *
 * These were copied verbatim between the exercise and workout modules — nothing in a cursor codec
 * or a LIKE escaper is table-specific, and `docs/playbooks/add-entity.md` told every future entity
 * to copy them again. Only the scope filter legitimately differs per table.
 */

/** JSON-encoded because names contain spaces, so a naive separator splits in the wrong place. */
export const encodeCursor = (name: string, id: string) =>
  Buffer.from(JSON.stringify([name, id])).toString('base64url')

// The id is a uuid, checked here: a well-formed cursor with any other id reached the uuid cast as a
// 500 instead of meaning "start over".
const Cursor = z.tuple([z.string(), z.uuid()])

/** A cursor is client input, so it is parsed, not trusted. A malformed one means "start over". */
export function decodeCursor(cursor: string | undefined): { name: string; id: string } | null {
  if (cursor === undefined) return null
  try {
    const parsed = Cursor.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
    if (!parsed.success) return null
    const [name, id] = parsed.data
    return { name, id }
  } catch {
    return null
  }
}

/**
 * `%`, `_` and `\` are LIKE wildcards. Unescaped, searching for '50%' matches everything starting
 * '50', a lone '_' matches every row, and a bare '%' scans the whole table — defeating the very
 * index the search exists for.
 */
export const escapeLikePattern = (term: string) => term.replaceAll(/[\\%_]/gu, (m) => `\\${m}`)

/**
 * Fold flat rows into a map by key. Was independently written in three modules.
 *
 * Two overloads rather than a defaulted mapper: an identity default has to cast through `unknown`,
 * which defeats the generic it is meant to serve.
 */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]>
export function groupBy<T, V>(
  rows: readonly T[],
  key: (row: T) => string,
  value: (row: T) => V,
): Map<string, V[]>
export function groupBy<T, V>(
  rows: readonly T[],
  key: (row: T) => string,
  value?: (row: T) => V,
): Map<string, (T | V)[]> {
  const grouped = new Map<string, (T | V)[]>()
  for (const row of rows) {
    const list = grouped.get(key(row)) ?? []
    list.push(value === undefined ? row : value(row))
    grouped.set(key(row), list)
  }
  return grouped
}
