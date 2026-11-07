import { describe, expect, test } from 'bun:test'
import { addressKey, clientAddress } from './client-address.ts'

/** Caddy decides who the client is (apps/app/Caddyfile); the API takes its word. */
describe('clientAddress', () => {
  test('is the address Caddy names', () => {
    expect(clientAddress('203.0.113.7', '172.18.0.3')).toBe('203.0.113.7')
  })

  test('without one — the API reached directly, in development — is the connection', () => {
    expect(clientAddress(undefined, '127.0.0.1')).toBe('127.0.0.1')
    expect(clientAddress('  ', '::1')).toBe('::1')
  })

  test('nothing to go on is one address of its own, never an empty one', () => {
    expect(clientAddress()).toBe('unknown')
  })
})

/**
 * What the limit counts an address as. An IPv6 client is usually handed a whole /64, so counted per
 * address it would have unlimited guesses: it is counted per /64 instead.
 */
describe('addressKey', () => {
  test.each([
    ['203.0.113.7', '203.0.113.7'],
    ['203.0.113.7:51234', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::9', '2001:db8:1:2::/64'],
    ['[2001:DB8:1:2::9]:443', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['unknown', 'unknown'],
  ])('%s → %s', (address, key) => {
    expect(addressKey(address)).toBe(key)
  })
})
