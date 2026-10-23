import { z } from 'zod'
import { Id } from './primitives.ts'
import { User } from './user.ts'

/**
 * A member who shares their training with a group the caller edits, as that coach sees them (#11).
 * `GET /athletes`, and the MCP tool `athlete_list`. See GLOSSARY.md, "Athlete", and
 * docs/adr/0021-coaching-through-groups.md.
 */
export const Athlete = z.object({
  user: User,
  /** The groups they share their training through: groups the caller edits, at least one. */
  groups: z.array(z.object({ id: Id, name: z.string() })).min(1),
})
export type Athlete = z.output<typeof Athlete>

/**
 * Whose training an MCP read is of: an athlete's id from `athlete_list`, or — omitted — your own.
 * Over HTTP it is the path, `/athletes/:id/…`, so no route's body carries it.
 */
export const OfAthlete = z.object({
  athlete: Id.optional().describe(
    "An athlete's id from athlete_list, to read their training instead of yours",
  ),
})
