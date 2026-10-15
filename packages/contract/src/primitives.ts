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

type PatchShape<S extends z.ZodRawShape> = {
  [K in keyof S]: z.ZodOptional<S[K] extends z.ZodDefault<infer Inner> ? Inner : S[K]>
}

/**
 * The PATCH form of a create shape: every field optional, and every `.default()` REMOVED.
 *
 * Never `.partial()` a schema with defaults. Zod still applies a default inside `.partial()`, so an
 * omitted key comes out as its create-time value — and a service, rightly treating every present
 * key as an instruction, resets it. A description-only exercise patch once turned a plank into a
 * `weight_reps` lift and detached all of its media.
 */
export function patchOf<S extends z.ZodRawShape>(shape: S): PatchShape<S> {
  // Object.fromEntries cannot carry a mapped type; the schema tests prove the runtime shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [
      key,
      z.optional(field instanceof z.ZodDefault ? field.unwrap() : field),
    ]),
  ) as PatchShape<S>
}

/** `page(Exercise)` -> `{ items: Exercise[]; nextCursor: string | null }`. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  })
}

export type Page<T> = { items: T[]; nextCursor: string | null }
