import { and, count, eq, inArray, or } from 'drizzle-orm'
import {
  type Group,
  type GroupAddMember,
  type GroupCreate,
  type GroupMember,
  type GroupMembership,
  type GroupRole,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupMembers, groups, users } from '../../db/schema.ts'
import { conflict, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type GroupRow, keepsItsMembers, mayOf, readsTraining } from './rules.ts'
import { slugify } from './slug.ts'

/** The group, if its members change through the API; refused with the reason otherwise. */
async function changingMembersOf(groupId: string): Promise<GroupRow> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  if (group === undefined) throw notFound('group')
  const kept = keepsItsMembers(group)
  if (kept !== null) throw conflict(kept)
  return group
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
    .select({ group: groups, role: groupMembers.role, sharesTraining: groupMembers.sharesTraining })
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

  return rows.map((r) =>
    toMembership(r.group, r.role, {
      memberCount: memberCount(r.group.id, r.role),
      editors: countOf(r.group.id, 'editor'),
      sharesTraining: r.sharesTraining,
    }),
  )
}

/** A group as one member sees it: their role in it, and what they may do with it. */
function toMembership(
  row: GroupRow,
  role: GroupRole,
  of: { readonly memberCount: number; readonly editors: number; readonly sharesTraining: boolean },
): GroupMembership {
  const group = toGroup(row)
  const may = mayOf(row, role, of.editors)
  return {
    id: group.id,
    slug: group.slug,
    name: group.name,
    kind: group.kind,
    createdAt: group.createdAt,
    role,
    memberCount: of.memberCount,
    sharesTraining: of.sharesTraining,
    canManage: may.canManage,
    canLeave: may.canLeave,
    canTransferInto: may.canTransferInto,
    canShareTraining: may.canShareTraining,
  }
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
    return toMembership(created, 'editor', { memberCount: 1, editors: 1, sharesTraining: false })
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
      sharesTraining: groupMembers.sharesTraining,
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

  // The caller's own row is always among them: a reader sees themselves, an editor everyone.
  const shares = rows.find((r) => r.id === caller.userId)?.sharesTraining === true
  return rows.map((r) => ({
    user: {
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      createdAt: r.createdAt.toISOString(),
    },
    role: r.role,
    joinedAt: r.joinedAt.toISOString(),
    readsYourTraining: readsTraining(shares, r.role, r.id === caller.userId),
  }))
}

export async function addMember(
  caller: Caller,
  groupId: string,
  input: GroupAddMember,
): Promise<GroupMember> {
  // Not-an-editor and does-not-exist are the same answer, so membership is never leaked.
  if (!caller.editorGroupIds.includes(groupId)) throw notFound('group')

  await changingMembersOf(groupId)

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

  const [mine] = await db
    .select({ sharesTraining: groupMembers.sharesTraining })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, caller.userId)))
  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
    role: added.role,
    joinedAt: added.joinedAt.toISOString(),
    readsYourTraining: readsTraining(mine?.sharesTraining === true, added.role, false),
  }
}

/**
 * An editor removes a member; any member removes themselves — leaving. Removing anyone else as a
 * reader is refused as if there were no group, as adding is.
 */
export async function removeMember(caller: Caller, groupId: string, userId: string): Promise<void> {
  const leaving = userId === caller.userId
  if (!(leaving ? caller.groupIds : caller.editorGroupIds).includes(groupId)) {
    throw notFound('group')
  }

  // Outside the transaction: a group's kind and slug never change.
  await changingMembersOf(groupId)

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
