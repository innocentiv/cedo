import { z } from 'zod'

/**
 * The cursor carries the id alongside the timestamp, and the timestamp is passed through as an
 * epoch-milliseconds number plus the id, so nothing depends on string precision.
 */
const CursorShape = z.tuple([z.number(), z.string()])

export const encodeCursor = (row: { startedAt: Date; id: string } | undefined): string | null =>
  row === undefined
    ? null
    : Buffer.from(JSON.stringify([row.startedAt.getTime(), row.id])).toString('base64url')

export function decodeCursor(cursor: string | undefined): { startedAt: Date; id: string } | null {
  if (cursor === undefined) return null
  try {
    const parsed = CursorShape.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
    if (!parsed.success) return null
    const [millis, id] = parsed.data
    return { startedAt: new Date(millis), id }
  } catch {
    return null
  }
}
