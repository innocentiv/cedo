/**
 * Opaque bearer tokens for sessions and personal access tokens.
 *
 * Only the sha256 of a token is stored, so a database leak yields nothing usable, and a token can
 * be revoked by deleting its row — which is the reason for opaque tokens rather than JWTs.
 * See docs/06-api.md.
 */
const TOKEN_BYTES = 32

export interface MintedToken {
  /** Shown to the caller exactly once. Never stored. */
  readonly token: string
  /** What goes in the database. */
  readonly hash: string
}

export function mintToken(): MintedToken {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  const token = Buffer.from(bytes).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex')
}

/** Pull the credential out of an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | undefined | null): string | null {
  if (typeof header !== 'string') return null
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.length === 0) return null
  return value
}
