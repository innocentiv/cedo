import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import type { Athlete } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupMembers, groups, users } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type Training, own } from '../session/service.ts'

/**
 * A coach reading the training an athlete shares with them (#11): an editor of a group in which
 * the athlete's membership shares its training. Read-only by construction — every function here
 * reads — and decided on every request from the caller's groups as they are now, so a share
 * switched off, a member gone or an editor gone ends it at once, the past included.
 * See docs/adr/0021-coaching-through-groups.md.
 */

/** Memberships that share their training with a group the caller edits — never the caller's own. */
const sharingWith = (caller: Caller) =>
  and(
    inArray(groupMembers.groupId, caller.editorGroupIds),
    eq(groupMembers.sharesTraining, true),
    ne(groupMembers.userId, caller.userId),
  )

export async function athletes(caller: Caller): Promise<Athlete[]> {
  if (caller.editorGroupIds.length === 0) return []
  // Projected: a user row carries its password hash, which must never reach a response.
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      createdAt: users.createdAt,
      groupId: groups.id,
      groupName: groups.name,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(sharingWith(caller))
    .orderBy(asc(users.displayName), asc(users.id), asc(groups.name))

  const byUser = new Map<string, Athlete>()
  for (const r of rows) {
    const athlete = byUser.get(r.id) ?? {
      user: {
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        createdAt: r.createdAt.toISOString(),
      },
      groups: [],
    }
    athlete.groups.push({ id: r.groupId, name: r.groupName })
    byUser.set(r.id, athlete)
  }
  return [...byUser.values()]
}

/**
 * The athlete's training, read by the caller — or a 404 when they do not share it with a group the
 * caller edits. Indistinguishable from an account that does not exist, as an invisible workout is.
 */
export async function trainingOf(caller: Caller, athleteId: string): Promise<Training> {
  if (caller.editorGroupIds.length === 0) throw notFound('athlete')
  const [shared] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(sharingWith(caller), eq(groupMembers.userId, athleteId)))
    .limit(1)
  if (shared === undefined) throw notFound('athlete')
  return { reader: caller, athleteId }
}

/**
 * The caller's own training, or — named — an athlete's they coach: what an MCP tool reads, given
 * the optional `athlete` every coaching tool takes. One seam, so no tool decides whose it is.
 */
export const trainingFor = async (
  caller: Caller,
  athleteId: string | undefined,
): Promise<Training> =>
  athleteId === undefined ? own(caller) : await trainingOf(caller, athleteId)
