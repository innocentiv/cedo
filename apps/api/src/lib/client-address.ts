/**
 * Who a request came from, for the login limit (#72, ADR-0031).
 *
 * Only Caddy reaches the API — its port is never published — and Caddy trusts the proxies it sees on
 * a private network (`trusted_proxies static private_ranges` in apps/app/Caddyfile). So
 * `X-Forwarded-For` reaches the API as the client, then each proxy that passed it on, Caddy's last:
 * a host's nginx in front of Caddy adds itself after the client. Read from the right, the first
 * address that is not a proxy's is the client; anything to its left the client could have written
 * itself.
 */

/** Caddy's `private_ranges`, so the API and Caddy agree on who is a proxy. */
const PRIVATE_V4: readonly (readonly [number, number])[] = [
  [ipv4(10, 0, 0, 0), 8],
  [ipv4(172, 16, 0, 0), 12],
  [ipv4(192, 168, 0, 0), 16],
  [ipv4(127, 0, 0, 0), 8],
]

function ipv4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

function parseV4(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map(Number)
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null
  const [a = 0, b = 0, c = 0, d = 0] = octets
  return ipv4(a, b, c, d)
}

export function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === '::1') return true
  // An IPv4 address as IPv6 sees it: judged as the IPv4 address it is.
  const v4 = parseV4(lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower)
  if (v4 !== null) {
    return PRIVATE_V4.some(([base, bits]) => v4 >>> (32 - bits) === base >>> (32 - bits))
  }
  // fd00::/8, the unique local addresses a container network hands out.
  return lower.includes(':') && lower.startsWith('fd')
}

/**
 * The client, from `X-Forwarded-For` as Caddy passes it on, or else the connection itself. With
 * only proxies in the chain — an outer proxy that sends no `X-Forwarded-For` — it is the first of
 * them, and every client shares it: `platform_status` shows the address the last login came from,
 * so that is visible.
 */
export function clientAddress(forwardedFor?: string, connection?: string): string {
  const chain = (forwardedFor ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '')
  const client = chain.toReversed().find((a) => !isPrivateAddress(a)) ?? chain[0]
  return client ?? connection ?? 'unknown'
}
