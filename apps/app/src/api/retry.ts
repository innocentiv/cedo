import { ApiError, NetworkError } from './errors.ts'

/**
 * When a logged set is sent again, and under what key. A set sent on a weak signal may reach the
 * server and lose its answer; the phone cannot tell, so it sends the set again under the same
 * idempotency key, and the server answers a key it has stored with the stored set. Offline sets are
 * kept in memory only (#9): retried while the app is open, gone if it is closed first. Plain, so
 * it is tested beside it; `useLogSet` wires it into the query client, whose own wait between
 * tries — a second, doubling to thirty — is kept.
 */

/**
 * Sends of one set, the first included — about three minutes of tries. A wait while the phone is
 * offline is not a try: it is paused before sending. Past this the set is given up and the screen
 * says so, rather than holding the session's queue — and its finish — forever.
 */
export const MAX_SENDS = 10

/**
 * Nothing answered, or the server failed — the set may or may not be stored, and the key makes
 * sending it again safe. A refusal is an answer, and would be the same again.
 */
export const sendAgain = (failures: number, error: unknown): boolean =>
  failures < MAX_SENDS &&
  (error instanceof NetworkError || (error instanceof ApiError && error.status >= 500))

/**
 * A version 4 UUID from random bytes. Not `crypto.randomUUID`, which exists only in a secure
 * context — HTTPS or localhost — and the app also runs over plain HTTP on a home network.
 */
export function newIdempotencyKey(
  fill: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = fill(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
