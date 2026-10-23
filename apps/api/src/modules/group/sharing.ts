import { and, eq } from 'drizzle-orm'
import type { GroupMembership, GroupMembershipPatch } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupMembers, groups } from '../../db/schema.ts'
import { conflict, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { sharingRefused } from './rules.ts'
import { list } from './service.ts'

/**
 * A member's own switch: whether this group's editors read their training (#11). Only the caller's
 * membership, so nobody shares anyone else's. Switched off — or the membership gone — everything is
 * hidden at once, the past too. See docs/adr/0021-coaching-through-groups.md.
 */
export async function setSharing(
  caller: Caller,
  groupId: string,
  patch: GroupMembershipPatch,
): Promise<GroupMembership> {
  if (!caller.groupIds.includes(groupId)) throw notFound('group')

  const [group] = await db
    .select({ kind: groups.kind, slug: groups.slug })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1)
  if (group === undefined) throw notFound('group')
  const refused = sharingRefused(group)
  if (refused !== null) throw conflict(refused)

  await db
    .update(groupMembers)
    .set({ sharesTraining: patch.sharesTraining })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, caller.userId)))

  const membership = (await list(caller)).find((g) => g.id === groupId)
  if (membership === undefined) throw notFound('group')
  return membership
}
