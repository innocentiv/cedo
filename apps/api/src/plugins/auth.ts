import { Elysia } from 'elysia'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { groupMembers, sessions, users } from '../db/schema.ts'
import type { AccessContext } from '../db/ownable.ts'
import { unauthenticated } from '../lib/error.ts'
import { bearerToken, hashToken } from '../lib/token.ts'

/**
 * Resolves the caller in ONE query, on every authenticated request.
 *
 * The join returns one row per group membership, which is aggregated in JavaScript. That is a
 * single round trip; looking the session up and then fetching memberships would be two, and this
 * runs on literally every request. `bun run perf` asserts the query count stays at one.
 * See docs/adr/0018-n1-detection.md.
 */
export interface Caller extends AccessContext {
  readonly username: string
  readonly displayName: string
  readonly personalGroupId: string
}

export async function resolveCaller(
  authorization: string | undefined | null,
): Promise<Caller | null> {
  const token = bearerToken(authorization)
  if (token === null) return null

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      personalGroupId: users.personalGroupId,
      groupId: groupMembers.groupId,
      role: groupMembers.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))

  const first = rows[0]
  if (first === undefined) return null

  return foldCaller(first, rows)
}

/** One row per membership arrives from the join; this is the shape the ACL consumes. */
export interface MembershipRow {
  readonly groupId: string | null
  readonly role: 'editor' | 'reader' | null
}

export interface IdentityRow {
  readonly userId: string
  readonly username: string
  readonly displayName: string
  readonly personalGroupId: string
}

/**
 * Shared by BOTH credential paths — browser sessions here, personal access tokens in mcp/index.ts.
 * They differ only in which table the credential lives in and how expiry is expressed; the fold was
 * previously duplicated character for character, so adding a role or a scoped membership to one
 * would have left the other silently permissive.
 */
export function foldCaller(identity: IdentityRow, rows: readonly MembershipRow[]): Caller {
  const groupIds: string[] = []
  const editorGroupIds: string[] = []
  for (const row of rows) {
    if (row.groupId === null) continue
    groupIds.push(row.groupId)
    if (row.role === 'editor') editorGroupIds.push(row.groupId)
  }
  return { ...identity, groupIds, editorGroupIds }
}

/**
 * Routes opt in with `{ auth: true }` and receive a fully resolved `caller` in context.
 * There is no way to read an ownable table without one.
 *
 * Authentication happens in `transform`, NOT in `resolve`, because Elysia runs `transform` before
 * schema validation and `resolve` after it. With the check in `resolve`, an anonymous caller
 * posting a malformed body got a 422 telling them their body was wrong, when the real answer was
 * that they were not signed in.
 *
 * The resolved caller is handed from one hook to the other through a WeakMap keyed on the request
 * object, so authentication still costs exactly one query, the context stays inferable by Elysia
 * (annotating it breaks `caller`'s type in every handler), and nothing is retained after the
 * request is collected.
 */
const callerByRequest = new WeakMap<Request, Caller>()

export const authPlugin = new Elysia({ name: 'auth' }).macro({
  auth: {
    async transform({ request, headers }) {
      const caller = await resolveCaller(headers['authorization'])
      /**
       * Thrown, not returned as a hand-built `status(401, ...)`. Every error leaves through the
       * single `onError` handler, so the envelope and the code-to-status map live in one place.
       */
      if (caller === null) throw unauthenticated()
      callerByRequest.set(request, caller)
    },
    resolve({ request }) {
      const caller = callerByRequest.get(request)
      if (caller === undefined) throw unauthenticated()
      return { caller }
    },
  },
})
