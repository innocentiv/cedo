import { type SQL, and, desc, eq, gt, lt, sql } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { loginFailures } from '../../db/schema.ts'
import { rateLimited } from '../../lib/error.ts'

/**
 * The login limit (#72, ADR-0031). Failed logins are counted per client address and username, and
 * per address alone — never per username alone, or anyone could lock its owner out by failing on
 * purpose. Over either limit, a login is refused, the right password included, until enough of its
 * failures have aged out of the window. A success clears its address and username's failures.
 *
 * Two logins racing at the limit may both be let through: each counts before it fails. That costs an
 * attacker one or two guesses, which argon2 already makes slow, and saves a lock on every login.
 */

export const WINDOW_S = 15 * 60
export const PER_ADDRESS_AND_USERNAME = 10
export const PER_ADDRESS = 50

const inWindow = gt(loginFailures.at, sql`now() - make_interval(secs => ${WINDOW_S})`)

/**
 * Seconds until fewer than `limit` of these failures are left in the window: when the `limit`-th
 * newest ages out. Null while under the limit. Worked out by Postgres, which dated them.
 */
async function wait(failures: SQL | undefined, limit: number): Promise<number | null> {
  const [row] = await db
    .select({
      seconds: sql`greatest(1, ceil(extract(epoch from
        ${loginFailures.at} + make_interval(secs => ${WINDOW_S}) - now())))::int`.mapWith(Number),
    })
    .from(loginFailures)
    .where(and(failures, inWindow))
    .orderBy(desc(loginFailures.at))
    .offset(limit - 1)
    .limit(1)
  return row?.seconds ?? null
}

/** Refuses a login from `address` as `username` while either count is at its limit. */
export async function assertUnderLimit(address: string, username: string): Promise<void> {
  const fromHere = eq(loginFailures.address, address)
  const waits = await Promise.all([
    wait(and(fromHere, eq(loginFailures.username, username)), PER_ADDRESS_AND_USERNAME),
    wait(fromHere, PER_ADDRESS),
  ])
  const longest = Math.max(0, ...waits.map((w) => w ?? 0))
  if (longest > 0) throw rateLimited(longest)
}

/** A failed login: counted, after those that no longer count are pruned. */
export async function recordFailure(address: string, username: string): Promise<void> {
  await db
    .delete(loginFailures)
    .where(lt(loginFailures.at, sql`now() - make_interval(secs => ${WINDOW_S})`))
  await db.insert(loginFailures).values({ address, username })
}

/** A successful login forgives its own address and username, and nobody else's. */
export async function clearFailures(address: string, username: string): Promise<void> {
  await db
    .delete(loginFailures)
    .where(and(eq(loginFailures.address, address), eq(loginFailures.username, username)))
}

let lastAddress: string | null = null

/**
 * The address the last login attempt came from, since the server started: `platform_status` shows
 * it, so a curator can see whether it is a real client or the proxy in front of Caddy, in which case
 * every client shares one count (docs/09-deployment.md).
 */
export function noteAttempt(address: string): void {
  lastAddress = address
}

export const lastLoginAddress = (): string | null => lastAddress
