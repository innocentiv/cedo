import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { workoutSessions } from '../../db/schema.ts'

/**
 * The session list's keyset cursor: `started_at` as EXACT epoch microseconds, plus the id.
 *
 * Neither half may pass through a JS `Date`. A Date holds milliseconds while the column holds
 * microseconds, so a millisecond cursor skipped every session inside the truncated millisecond — a
 * burst of MCP `session_log` calls lands several there. And a Date interpolated into raw `sql`
 * bypasses the column encoder and fails in the driver, which made every page after the first a
 * 500. So Postgres renders the microseconds as an integer string, and reads them back with integer
 * interval arithmetic: no float, no Date, no timezone.
 */
const CursorShape = z.tuple([z.string().regex(/^\d{1,19}$/u), z.uuid()])

/** Selected alongside each row so the last one on a page can become the cursor. */
export const cursorMicros = sql<string>`(extract(epoch from ${workoutSessions.startedAt}) * 1000000)::bigint::text`

export const encodeCursor = (row: { micros: string; id: string }): string =>
  Buffer.from(JSON.stringify([row.micros, row.id])).toString('base64url')

/** A cursor is client input, so it is parsed, not trusted. A malformed one means "start over". */
export function decodeCursor(cursor: string | undefined): { micros: string; id: string } | null {
  if (cursor === undefined) return null
  try {
    const parsed = CursorShape.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
    if (!parsed.success) return null
    const [micros, id] = parsed.data
    return { micros, id }
  } catch {
    return null
  }
}

/** Strictly after the cursor in `(started_at desc, id desc)` order. */
export const afterCursor = (after: { micros: string; id: string }) =>
  sql`(${workoutSessions.startedAt}, ${workoutSessions.id}) < (timestamptz 'epoch' + ${after.micros}::bigint * interval '1 microsecond', ${after.id}::uuid)`
