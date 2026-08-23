import { and, count, eq, inArray } from 'drizzle-orm'
import type {
  Group,
  GroupAddMember,
  GroupCreate,
  GroupMember,
  GroupMembership,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupMembers, groups, users } from '../../db/schema.ts'
import { conflict, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

const slugify = (name: string): string =>
  `${name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-|-$/gu, '')
    .slice(0, 40)}-${crypto.randomUUID().slice(0, 8)}`

const toGroup = (row: typeof groups.$inferSelect): Group => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  kind: row.kind,
  createdAt: row.createdAt.toISOString(),
})

export async function list(caller: Caller): Promise<GroupMembership[]> {
  if (caller.groupIds.length === 0) return []

  const rows = await db
    .select({ group: groups, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, caller.userId))

  const counts = await db
    .select({ groupId: groupMembers.groupId, members: count() })
    .from(groupMembers)
    .where(
      inArray(
        groupMembers.groupId,
        rows.map((r) => r.group.id),
      ),
    )
    .groupBy(groupMembers.groupId)
  const memberCount = new Map(counts.map((c) => [c.groupId, c.members]))

  return rows.map((r) => {
    const group = toGroup(r.group)
    group satisfies Group
    return {
      id: group.id,
      slug: group.slug,
      name: group.name,
      kind: group.kind,
      createdAt: group.createdAt,
      role: r.role,
      memberCount: memberCount.get(r.group.id) ?? 0,
    }
  })
}

/** The creator becomes an editor, otherwise they could not put anything in it. */
export async function create(caller: Caller, input: GroupCreate): Promise<GroupMembership> {
  return await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(groups)
      .values({ slug: slugify(input.name), name: input.name, kind: 'shared' })
      .returning()
    if (created === undefined) throw new Error('Could not create the group')

    await tx
      .insert(groupMembers)
      .values({ groupId: created.id, userId: caller.userId, role: 'editor' })
    return { ...toGroup(created), role: 'editor' as const, memberCount: 1 }
  })
}

/** Membership is visible only to members — hence the `groupIds` check rather than a bare lookup. */
export async function members(caller: Caller, groupId: string): Promise<GroupMember[]> {
  if (!caller.groupIds.includes(groupId)) throw notFound('group')

  const rows = await db
    .select({ user: users, role: groupMembers.role, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))

  return rows.map((r) => ({
    user: {
      id: r.user.id,
      username: r.user.username,
      displayName: r.user.displayName,
      createdAt: r.user.createdAt.toISOString(),
    },
    role: r.role,
    joinedAt: r.joinedAt.toISOString(),
  }))
}

export async function addMember(
  caller: Caller,
  groupId: string,
  input: GroupAddMember,
): Promise<GroupMember> {
  // Not-an-editor and does-not-exist are the same answer, so membership is never leaked.
  if (!caller.editorGroupIds.includes(groupId)) throw notFound('group')

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  if (group === undefined) throw notFound('group')
  if (group.kind === 'personal') throw conflict('A personal group cannot take members')

  const [user] = await db.select().from(users).where(eq(users.username, input.username)).limit(1)
  if (user === undefined) throw notFound('user')

  const [existing] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    .limit(1)
  if (existing !== undefined) throw conflict('Already a member')

  const [added] = await db
    .insert(groupMembers)
    .values({ groupId, userId: user.id, role: input.role })
    .returning()
  if (added === undefined) throw new Error('Could not add the member')

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
    role: added.role,
    joinedAt: added.joinedAt.toISOString(),
  }
}

export async function removeMember(caller: Caller, groupId: string, userId: string): Promise<void> {
  if (!caller.editorGroupIds.includes(groupId)) throw notFound('group')

  const remaining = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))

  const editors = remaining.filter((r) => r.role === 'editor')
  const target = remaining.find((r) => r.userId === userId)
  if (target === undefined) throw notFound('member')

  // A group nobody can edit is unusable and unrecoverable through the API.
  if (target.role === 'editor' && editors.length === 1) {
    throw conflict('A group must keep at least one editor')
  }

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
}
