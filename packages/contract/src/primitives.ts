import { z } from 'zod'

/**
 * Shared building blocks.
 *
 * Convention: INPUT schemas are strict (unknown keys are rejected), OUTPUT schemas are not.
 * A strict input turns an AI's typo — `{ nam: 'Bench' }` — into a loud validation error instead of
 * an entity with a missing name. A lenient output means a server that gains a field does not break
 * clients that have not been rebuilt.
 */

export const Id = z.uuid()
export type Id = z.output<typeof Id>

/** ISO-8601 with timezone. Always UTC on the wire. */
export const Timestamp = z.iso.datetime()
export type Timestamp = z.output<typeof Timestamp>

export const NonEmptyString = z.string().trim().min(1)

export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u, 'Must be lowercase alphanumeric with - or _ separators')
export type Slug = z.output<typeof Slug>

/** A zero-based position within an ordered sibling list. */
export const OrderIndex = z.int().min(0).max(9999)

/**
 * Cursor pagination. `z.coerce` is mandatory on query schemas — query strings are always strings.
 * See docs/06-api.md.
 */
export const PaginationQuery = z.strictObject({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export type PaginationQuery = z.output<typeof PaginationQuery>

/** `page(Exercise)` -> `{ items: Exercise[]; nextCursor: string | null }`. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  })
}

export type Page<T> = { items: T[]; nextCursor: string | null }
