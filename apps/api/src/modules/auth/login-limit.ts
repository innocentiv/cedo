import { type SQL, and, desc, eq, gt, lt, sql } from 'drizzle-orm'
import { minutesToS } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { loginFailures } from '../../db/schema.ts'
import { addressKey } from '../../lib/client-address.ts'
import { rateLimited } from '../../lib/error.ts'

/**
 * The login limit (#72, ADR-0031). Failed logins are counted per client address and username, and
 * per address alone — never per username alone, or anyone could lock its owner out by failing on
 * purpose. Over either limit, a login is refused, the right password included, until enough of its
 * failures have aged out of the window.
 *
 * Each login is written down as a failure BEFORE its password is checked, and counts itself: a burst
 * of logins at once then counts each other, so no more than the limit get a guess. Checking first
 * and writing after the password let thirty at once all through. A refused login takes its row back;
 * a success forgives its address and username's, its own included.
 */

export const WINDOW_S = minutesToS(15)
export const PER_ADDRESS_AND_USERNAME = 10
export const PER_ADDRESS = 50

/** A login, as the limit counts it. */
export interface LoginFrom {
  readonly address: string
  readonly username: string
}

/** As counted: an IPv6 address by its /64 (`addressKey`). */
const counted = (from: LoginFrom): LoginFrom => ({ ...from, address: addressKey(from.address) })

const windowStart = sql`now() - make_interval(secs => ${WINDOW_S})`
const inWindow = gt(loginFailures.at, windowStart)

/**
 * The `n`-th newest of these failures still in the window, as seconds until it ages out — or null
 * when there are fewer than `n`. Worked out by Postgres, which dated them.
 */
async function nthNewest(failures: SQL | undefined, n: number): Promise<number | null> {
  const [row] = await db
    .select({
      seconds: sql`greatest(1, ceil(extract(epoch from
        ${loginFailures.at} + make_interval(secs => ${WINDOW_S}) - now())))::int`.mapWith(Number),
    })
    .from(loginFailures)
    .where(and(failures, inWindow))
    .orderBy(desc(loginFailures.at))
    .offset(n - 1)
    .limit(1)
  return row?.seconds ?? null
}

function counts({ address, username }: LoginFrom) {
  const fromHere = eq(loginFailures.address, address)
  return [
    {
      failures: and(fromHere, eq(loginFailures.username, username)),
      limit: PER_ADDRESS_AND_USERNAME,
    },
    { failures: fromHere, limit: PER_ADDRESS },
  ]
}

/**
 * Lets a login try its password, written down as a failure until it succeeds — or refuses it,
 * taking its row back, while either count is over its limit. `Retry-After` is when the `limit`-th
 * newest of the rest ages out.
 */
export async function admit(from: LoginFrom): Promise<void> {
  const login = counted(from)
  await db.delete(loginFailures).where(lt(loginFailures.at, windowStart))
  const [own] = await db.insert(loginFailures).values(login).returning({ id: loginFailures.id })
  const over = await Promise.all(
    counts(login).map(
      async ({ failures, limit }) => (await nthNewest(failures, limit + 1)) !== null,
    ),
  )
  if (!over.some(Boolean)) return

  if (own !== undefined) await db.delete(loginFailures).where(eq(loginFailures.id, own.id))
  const waits = await Promise.all(
    counts(login).map(async ({ failures, limit }) => (await nthNewest(failures, limit)) ?? 0),
  )
  throw rateLimited(Math.max(1, ...waits))
}

/** A successful login forgives its own address and username, its own attempt included. */
export async function forgive(from: LoginFrom): Promise<void> {
  const { address, username } = counted(from)
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

export const lastLoginAttemptAddress = (): string | null => lastAddress
