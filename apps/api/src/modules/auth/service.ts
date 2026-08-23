import { eq } from 'drizzle-orm'
import {
  DEFAULT_GROUP_SLUG,
  type AuthResult,
  type LoginInput,
  type Me,
  type RegisterInput,
  type User,
} from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { groupMembers, groups, sessions, users } from '../../db/schema.ts'
import { conflict, notFound, unauthenticated } from '../../lib/error.ts'
import { burnTime, hashPassword, verifyPassword } from '../../lib/password.ts'
import { hashToken, mintToken } from '../../lib/token.ts'
import type { Caller } from '../../plugins/auth.ts'
import * as GroupService from '../group/service.ts'

const SESSION_DAYS = 90

interface PublicUserRow {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly createdAt: Date
}

/** Takes the four public columns, so callers are free to project rather than select `users.*`. */
const toUser = (row: PublicUserRow): User => ({
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

/** A user without a personal group could not own anything, so this is never optional. */
async function createPersonalGroup(tx: Transaction, displayName: string) {
  const [personal] = await tx
    .insert(groups)
    .values({ slug: `user-${crypto.randomUUID()}`, name: displayName, kind: 'personal' })
    .returning()
  if (personal === undefined) throw new Error('Could not create the personal group')
  return personal
}

/**
 * Creates the user, their personal group, and both memberships in one transaction.
 *
 * The personal group is what makes "mine" and "shared with me" the same mechanism, so a user
 * without one could not own anything — hence all of it succeeds or none of it does.
 * See docs/03-domain-model.md.
 */
export async function register(input: RegisterInput): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password)

  const user = await db.transaction(async (tx) => {
    const personal = await createPersonalGroup(tx, input.displayName)
    /**
     * Uniqueness is decided by the index, not by a prior SELECT. A check-then-insert lets two
     * concurrent registrations both pass the check, and the loser then raises a raw unique
     * violation that surfaces as a 500 instead of a 409.
     */
    const [created] = await tx
      .insert(users)
      .values({
        username: input.username,
        passwordHash,
        displayName: input.displayName,
        personalGroupId: personal.id,
      })
      .onConflictDoNothing({ target: users.username })
      .returning()
    if (created === undefined) throw conflict('That username is taken')

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
  // The one query that legitimately reads password_hash. Nothing here reaches the wire.
  const [found] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      createdAt: users.createdAt,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.username, input.username))
    .limit(1)

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

/** Delegates the group half to GroupService so the two never drift. */
export async function me(caller: Caller): Promise<Me> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, caller.userId))
    .limit(1)
  if (row === undefined) throw notFound('user')

  return {
    user: {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
    },
    groups: await GroupService.list(caller),
  }
}
