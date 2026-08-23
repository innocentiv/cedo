/**
 * Password hashing. `Bun.password` uses argon2id by default and stores the algorithm and
 * parameters inside the hash, so verification needs no configuration and a future parameter
 * change does not invalidate existing hashes.
 */

/**
 * A hash of a value nobody knows, used to spend the same time on a missing user as on a real one.
 * Without it, sign-in latency reveals which usernames exist.
 */
const DECOY_HASH = await Bun.password.hash(crypto.randomUUID() + crypto.randomUUID())

export const hashPassword = async (plaintext: string): Promise<string> =>
  await Bun.password.hash(plaintext)

export const verifyPassword = async (plaintext: string, hash: string): Promise<boolean> =>
  await Bun.password.verify(plaintext, hash)

/** Call when the username was not found, so the response time matches a real verification. */
export const burnTime = async (plaintext: string): Promise<void> => {
  await Bun.password.verify(plaintext, DECOY_HASH)
}
