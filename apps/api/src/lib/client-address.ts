/**
 * Who a request came from, for the login limit (#72, ADR-0031).
 *
 * Decided by Caddy, not here: only Caddy reaches the API — its port is never published — and it
 * sends `X-Client-Ip`, its `{client_ip}`, overwriting any a client wrote. That is the connection's
 * address, or the client a trusted proxy named in `X-Forwarded-For` when CEDO_TRUSTED_PROXIES trusts
 * one (apps/app/Caddyfile). Without the header — the API reached directly, in development — the
 * connection's own address.
 */
export function clientAddress(fromCaddy?: string, connection?: string): string {
  const named = fromCaddy?.trim()
  return named === undefined || named === '' ? (connection ?? 'unknown') : named
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
