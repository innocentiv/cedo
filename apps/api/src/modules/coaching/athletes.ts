import { asc, eq } from 'drizzle-orm'
import type { Athlete } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupMembers, groups, users } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { sharingWith } from './training.ts'

/**
 * The athletes a coach has (#11): those whose membership of a group the caller edits shares their
 * training. Read-only by construction. Whose training a read is of is `training.ts`'s.
 * See docs/adr/0021-coaching-through-groups.md.
 */
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
