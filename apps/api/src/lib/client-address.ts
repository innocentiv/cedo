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

/** Eight hextets from an IPv6 address written with `::`, or null if it is not one. */
function hextets(address: string): string[] | null {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const [head = '', tail] = halves
  const left = head === '' ? [] : head.split(':')
  const right = tail === undefined || tail === '' ? [] : tail.split(':')
  const zeros = tail === undefined ? 0 : 8 - left.length - right.length
  const all = [...left, ...Array.from({ length: zeros }, () => '0'), ...right]
  const valid = all.length === 8 && all.every((h) => /^[0-9a-f]{1,4}$/u.test(h))
  return valid ? all.map((h) => h.replace(/^0+(?=.)/u, '')) : null
}

/**
 * What the login limit counts an address as. A port, the brackets around an IPv6 address and an IPv4
 * address written as IPv6 are dropped. An IPv6 client is counted by its /64: one is usually handed a
 * whole /64, and counted per address it would have unlimited guesses.
 */
export function addressKey(address: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/u.exec(address.trim())
  const bare = (bracketed?.[1] ?? address.trim()).toLowerCase().replace(/^::ffff:(?=\d+\.)/u, '')
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/u.exec(bare)
  if (v4?.[1] !== undefined) return v4[1]
  const six = hextets(bare)
  return six === null ? bare : `${six.slice(0, 4).join(':')}::/64`
}
