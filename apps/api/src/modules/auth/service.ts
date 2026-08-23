import { count, eq, inArray } from 'drizzle-orm'
import {
  DEFAULT_GROUP_SLUG,
  type AuthResult,
  type LoginInput,
  type Me,
  type RegisterInput,
  type User,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupMembers, groups, sessions, users } from '../../db/schema.ts'
import { conflict, notFound, unauthenticated } from '../../lib/error.ts'
import { burnTime, hashPassword, verifyPassword } from '../../lib/password.ts'
import { hashToken, mintToken } from '../../lib/token.ts'
import type { Caller } from '../../plugins/auth.ts'

const SESSION_DAYS = 90

const toUser = (row: typeof users.$inferSelect): User => ({
  id: row.id,
  username: row.username,
  displayName: row.displayName,
  createdAt: row.createdAt.toISOString(),
})

function expiry(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

async function issueSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const { token, hash } = mintToken()
  const expiresAt = expiry(SESSION_DAYS)
  await db.insert(sessions).values({ userId, tokenHash: hash, expiresAt })
  return { token, expiresAt }
}

/**
 * Creates the user, their personal group, and both memberships in one transaction.
 *
 * The personal group is what makes "mine" and "shared with me" the same mechanism, so a user
 * without one could not own anything — hence all of it succeeds or none of it does.
 * See docs/03-domain-model.md.
 */
export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, input.username))
  if (existing.length > 0) throw conflict('That username is taken')

  const passwordHash = await hashPassword(input.password)

  const user = await db.transaction(async (tx) => {
    const [personal] = await tx
      .insert(groups)
      .values({ slug: `user-${crypto.randomUUID()}`, name: input.displayName, kind: 'personal' })
      .returning()
    if (personal === undefined) throw new Error('Could not create the personal group')

    const [created] = await tx
      .insert(users)
      .values({
        username: input.username,
        passwordHash,
        displayName: input.displayName,
        personalGroupId: personal.id,
      })
      .returning()
    if (created === undefined) throw new Error('Could not create the user')

    await tx
      .insert(groupMembers)
      .values({ groupId: personal.id, userId: created.id, role: 'editor' })

    // Everyone reads the seeded starter library.
    const [shared] = await tx
      .select()
      .from(groups)
      .where(eq(groups.slug, DEFAULT_GROUP_SLUG))
      .limit(1)
    if (shared !== undefined) {
      await tx
        .insert(groupMembers)
        .values({ groupId: shared.id, userId: created.id, role: 'reader' })
    }

    return created
  })

  const { token, expiresAt } = await issueSession(user.id)
  return { user: toUser(user), token, expiresAt: expiresAt.toISOString() }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const [found] = await db.select().from(users).where(eq(users.username, input.username)).limit(1)

  if (found === undefined) {
    // Spend the same time as a real verification so latency does not reveal which users exist.
    await burnTime(input.password)
    throw unauthenticated('Incorrect username or password')
  }
  if (!(await verifyPassword(input.password, found.passwordHash))) {
    throw unauthenticated('Incorrect username or password')
  }

  const { token, expiresAt } = await issueSession(found.id)
  return { user: toUser(found), token, expiresAt: expiresAt.toISOString() }
}

export async function logout(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

export async function me(caller: Caller): Promise<Me> {
  const [row] = await db.select().from(users).where(eq(users.id, caller.userId)).limit(1)
  if (row === undefined) throw notFound('user')

  const memberships = await db
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      kind: groups.kind,
      createdAt: groups.createdAt,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, caller.userId))

  // Scoped to the caller's own groups. Counting without this bound would scan every membership
  // row in the database and report on groups the caller cannot see.
  const counts =
    memberships.length === 0
      ? []
      : await db
          .select({ groupId: groupMembers.groupId, members: count() })
          .from(groupMembers)
          .where(
            inArray(
              groupMembers.groupId,
              memberships.map((m) => m.id),
            ),
          )
          .groupBy(groupMembers.groupId)

  const memberCount = new Map(counts.map((c) => [c.groupId, c.members]))

  return {
    user: toUser(row),
    groups: memberships.map((g) => ({
      id: g.id,
      slug: g.slug,
      name: g.name,
      kind: g.kind,
      role: g.role,
      memberCount: memberCount.get(g.id) ?? 0,
      createdAt: g.createdAt.toISOString(),
    })),
  }
}
