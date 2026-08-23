import { z } from 'zod'
import { Id, NonEmptyString, Timestamp } from './primitives.ts'

/**
 * Personal access tokens authenticate the MCP server, so an AI acts as a real user under exactly
 * the same permissions as the UI. See docs/07-mcp.md.
 *
 * Only `sha256(token)` is stored, so a database leak does not yield usable credentials, and a token
 * can be revoked — which is the reason for opaque tokens rather than JWTs.
 */

export const PersonalAccessToken = z.object({
  id: Id,
  name: z.string(),
  lastUsedAt: Timestamp.nullable(),
  expiresAt: Timestamp.nullable(),
  createdAt: Timestamp,
})
export type PersonalAccessToken = z.output<typeof PersonalAccessToken>

export const PersonalAccessTokenCreate = z.strictObject({
  name: NonEmptyString.max(80),
  /** null means it never expires. */
  expiresInDays: z.int().positive().max(3650).nullable().default(null),
})
export type PersonalAccessTokenCreate = z.output<typeof PersonalAccessTokenCreate>

/** The only response that ever contains the secret. It is not recoverable afterwards. */
export const PersonalAccessTokenCreated = PersonalAccessToken.extend({
  token: z.string(),
})
export type PersonalAccessTokenCreated = z.output<typeof PersonalAccessTokenCreated>
