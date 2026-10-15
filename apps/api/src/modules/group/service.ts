import { and, count, eq, inArray, or } from 'drizzle-orm'
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

/**
 * Must ALWAYS satisfy the contract's `Slug` schema. It does not merely name the group: `Group.slug`
 * is validated on the way out, and `GroupMembership` appears in `GET /groups` AND `GET /auth/me` —
 * so one bad slug 422s those routes permanently for every member of that group.
 *
 * The two ways the naive version broke: slicing to a fixed length could cut on a hyphen and leave
 * a trailing or doubled separator, and a name with no ASCII alphanumerics at all ('💪',
 * 'Тренировки', '!!!') reduced to an empty base.
 */
const SLUG_BASE_LIMIT = 40

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .slice(0, SLUG_BASE_LIMIT)
    // Strip separators AFTER slicing — slicing is what creates a dangling one.
    .replaceAll(/^-+|-+$/gu, '')

  const suffix = crypto.randomUUID().slice(0, 8)
  return base === '' ? `group-${suffix}` : `${base}-${suffix}`
}

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
    .select({ groupId: groupMembers.groupId, role: groupMembers.role, members: count() })
    .from(groupMembers)
    .where(
      inArray(
        groupMembers.groupId,
        rows.map((r) => r.group.id),
      ),
    )
    .groupBy(groupMembers.groupId, groupMembers.role)
  const countOf = (groupId: string, role: 'editor' | 'reader') =>
    counts.find((c) => c.groupId === groupId && c.role === role)?.members ?? 0

  /**
   * The count a member may see matches the list they may see (`members` below): everyone for an
   * editor; the editors and themselves for a reader. The full count on the starter library, which
   * every account reads, was the number of accounts on the instance.
   */
  const memberCount = (groupId: string, role: 'editor' | 'reader') =>
    role === 'editor'
      ? countOf(groupId, 'editor') + countOf(groupId, 'reader')
      : countOf(groupId, 'editor') + 1

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
      memberCount: memberCount(r.group.id, r.role),
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

/**
 * Membership is visible only to members — hence the `groupIds` check rather than a bare lookup —
 * and in full only to EDITORS. A reader sees who runs the group, and themselves.
 *
 * Every account is a reader of the starter library, so "any member sees every member" let any user
 * list every account on the instance through it. The same rule is right for a coach's group: the
 * athletes see the coach, not each other. Where everyone edits, everyone sees everyone.
 */
export async function members(caller: Caller, groupId: string): Promise<GroupMember[]> {
  if (!caller.groupIds.includes(groupId)) throw notFound('group')
  const seesEveryone = caller.editorGroupIds.includes(groupId)

  // Columns projected explicitly. `select({ user: users })` would pull password_hash across the
  // wire on every membership listing, one careless spread away from a response body.
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      createdAt: users.createdAt,
      role: groupMembers.role,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        seesEveryone
          ? undefined
          : or(eq(groupMembers.role, 'editor'), eq(groupMembers.userId, caller.userId)),
      ),
    )

  return rows.map((r) => ({
    user: {
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      createdAt: r.createdAt.toISOString(),
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

  // Projected: this row is serialised into the response, so it must not carry password_hash.
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.username, input.username))
    .limit(1)
  if (user === undefined) throw notFound('user')

  // The primary key is the check. A SELECT first was a check-then-act: two concurrent adds both
  // passed it, and the loser hit the key as a 500.
  const [added] = await db
    .insert(groupMembers)
    .values({ groupId, userId: user.id, role: input.role })
    .onConflictDoNothing()
    .returning()
  if (added === undefined) throw conflict('Already a member')

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

  /**
   * The count and the delete must be atomic. Two editors removing each other simultaneously would
   * otherwise both see two editors, both pass the check, and both commit — leaving a group with no
   * editor, which is unusable and unrecoverable through the API. `for('update')` locks the
   * membership rows so the second transaction re-reads after the first commits.
   */
  await db.transaction(async (tx) => {
    const remaining = await tx
      .select({ userId: groupMembers.userId, role: groupMembers.role })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .for('update')

    const editors = remaining.filter((r) => r.role === 'editor')
    const target = remaining.find((r) => r.userId === userId)
    if (target === undefined) throw notFound('member')

    if (target.role === 'editor' && editors.length === 1) {
      throw conflict('A group must keep at least one editor')
    }

    await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  })
}
