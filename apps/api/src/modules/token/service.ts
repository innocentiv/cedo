import { and, desc, eq } from 'drizzle-orm'
import {
  type PersonalAccessToken,
  type PersonalAccessTokenCreate,
  type PersonalAccessTokenCreated,
  daysToMs,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { personalAccessTokens } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import { mintToken } from '../../lib/token.ts'
import type { Caller } from '../../plugins/auth.ts'

const toToken = (row: typeof personalAccessTokens.$inferSelect): PersonalAccessToken => ({
  id: row.id,
  name: row.name,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

export async function list(caller: Caller): Promise<PersonalAccessToken[]> {
  const rows = await db
    .select()
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, caller.userId))
    .orderBy(desc(personalAccessTokens.createdAt))
  return rows.map((row) => toToken(row))
}

/** The only response that ever contains the secret; it is not recoverable afterwards. */
export async function create(
  caller: Caller,
  input: PersonalAccessTokenCreate,
): Promise<PersonalAccessTokenCreated> {
  const { token, hash } = mintToken()
  const expiresAt =
    input.expiresInDays === null ? null : new Date(Date.now() + daysToMs(input.expiresInDays))

  const [created] = await db
    .insert(personalAccessTokens)
    .values({ userId: caller.userId, name: input.name, tokenHash: hash, expiresAt })
    .returning()
  if (created === undefined) throw new Error('Could not create the token')

  return { ...toToken(created), token }
}

export async function revoke(caller: Caller, id: string): Promise<void> {
  const deleted = await db
    .delete(personalAccessTokens)
    .where(and(eq(personalAccessTokens.id, id), eq(personalAccessTokens.userId, caller.userId)))
    .returning({ id: personalAccessTokens.id })
  if (deleted.length === 0) throw notFound('token')
}
