import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { groupMembers, personalAccessTokens, users } from '../db/schema.ts'
import { bearerToken, hashToken } from '../lib/token.ts'
import { type Caller, foldCaller } from '../plugins/auth.ts'

/**
 * A personal access token, NOT a session token. The two are deliberately not interchangeable: a
 * PAT is long-lived and pasted into an AI client's config, a session token belongs to a browser.
 *
 * Resolves the caller in one query, exactly like the HTTP auth macro, and records last use so an
 * abandoned token is visible in the UI.
 */
export async function resolveTokenCaller(authorization: string | null): Promise<Caller | null> {
  const token = bearerToken(authorization)
  if (token === null) return null

  const rows = await tokenRows(token)
  const first = rows[0]
  if (first === undefined) return null

  // Not awaited: last-used is bookkeeping, and a caller should never wait on it.
  void db
    .update(personalAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(personalAccessTokens.id, first.tokenId))
    .catch((error: unknown) => {
      console.error('Could not record personal access token use:', error)
    })

  return foldCaller(first, rows)
}

/** One query: the token, its user, and every group membership. Same shape as the HTTP auth macro. */
async function tokenRows(token: string) {
  return await db
    .select({
      tokenId: personalAccessTokens.id,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      weightUnit: users.weightUnit,
      personalGroupId: users.personalGroupId,
      groupId: groupMembers.groupId,
      role: groupMembers.role,
    })
    .from(personalAccessTokens)
    .innerJoin(users, eq(users.id, personalAccessTokens.userId))
    .leftJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(
      and(
        eq(personalAccessTokens.tokenHash, hashToken(token)),
        or(isNull(personalAccessTokens.expiresAt), gt(personalAccessTokens.expiresAt, new Date())),
      ),
    )
}
