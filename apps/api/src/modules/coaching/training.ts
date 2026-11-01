import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { groupMembers, workoutSessions } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * Whose training a read — or an athlete record — is of, and who is asking: two things the caller
 * used to be at once (#11). `reader` decides what is visible: ADR-0019's relations, so the names of
 * exercises, plans and days. `athleteId` decides whose sessions are read, and whose records.
 *
 * Your own is `own(caller)`. A coach's of an athlete comes only from `ownOrCoached`, once the athlete
 * shares their training with a group the coach edits; decided on every request from the caller's
 * groups as they are now, so a share switched off, a member gone or an editor gone ends it at once,
 * the past included. See docs/adr/0021-coaching-through-groups.md.
 *
 * Minted here only: it carries `resolved`, which no other module can name, so a `Training` written
 * by hand does not compile. Whatever takes one was told whose it is by `own` or `ownOrCoached`.
 */
export interface Training {
  readonly reader: Caller
  readonly athleteId: string
  readonly [resolved]: true
}

const resolved = Symbol('Training: resolved by own or ownOrCoached')

const mint = (reader: Caller, athleteId: string): Training => ({
  reader,
  athleteId,
  [resolved]: true,
})

export const own = (caller: Caller): Training => mint(caller, caller.userId)

/** The sessions of this training: whose they are, never what the reader may see of them. */
export const sessionsOf = (training: Training) => eq(workoutSessions.userId, training.athleteId)

/** Memberships that share their training with a group the caller edits — never the caller's own. */
export const sharingWith = (caller: Caller) =>
  and(
    inArray(groupMembers.groupId, caller.editorGroupIds),
    eq(groupMembers.sharesTraining, true),
    ne(groupMembers.userId, caller.userId),
  )

/**
 * An athlete's training, as the caller who coaches them — or a 404 when they do not share it with a
 * group the caller edits. Indistinguishable from an account that does not exist, as an invisible
 * workout is.
 */
async function coached(caller: Caller, athleteId: string): Promise<Training> {
  if (caller.editorGroupIds.length === 0) throw notFound('athlete')
  const [shared] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(sharingWith(caller), eq(groupMembers.userId, athleteId)))
    .limit(1)
  if (shared === undefined) throw notFound('athlete')
  return mint(caller, athleteId)
}

/**
 * The caller's own training, or — named — an athlete's they coach. The one place a read, or an
 * athlete record written, is told whose it is: `/athletes/:id/…` always names one, an MCP tool's
 * `athlete` may. Reads of their training change none of it; their records are the one thing a
 * coach writes.
 */
export const ownOrCoached = async (
  caller: Caller,
  athleteId: string | undefined,
): Promise<Training> => (athleteId === undefined ? own(caller) : await coached(caller, athleteId))
