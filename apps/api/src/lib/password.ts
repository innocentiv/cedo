/**
 * Password hashing. `Bun.password` uses argon2id by default and stores the algorithm and
 * parameters inside the hash, so verification needs no configuration and a future parameter
 * change does not invalidate existing hashes.
 */

/**
 * A hash of a value nobody knows, used to spend the same time on a missing user as on a real one.
 * Without it, sign-in latency reveals which usernames exist.
 *
 * Derived lazily: a top-level `await` here would put a full argon2id derivation on the import path
 * of the server and of every test worker, including runs that never reach a failed login.
 */
let decoyHash: Promise<string> | undefined

export const hashPassword = async (plaintext: string): Promise<string> =>
  await Bun.password.hash(plaintext)

export const verifyPassword = async (plaintext: string, hash: string): Promise<boolean> =>
  await Bun.password.verify(plaintext, hash)

/** Call when the username was not found, so the response time matches a real verification. */
export const burnTime = async (plaintext: string): Promise<void> => {
  decoyHash ??= Bun.password.hash(crypto.randomUUID() + crypto.randomUUID())
  await Bun.password.verify(plaintext, await decoyHash)
}
