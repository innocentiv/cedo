import { describe, expect, test } from 'bun:test'
import { addressKey, clientAddress, isPrivateAddress } from './client-address.ts'

describe('clientAddress', () => {
  test('a client reaching Caddy directly: the one address Caddy wrote', () => {
    expect(clientAddress('203.0.113.7', '172.18.0.3')).toBe('203.0.113.7')
  })

  test('behind a proxy on the host: the client, before the proxies that passed it on', () => {
    expect(clientAddress('203.0.113.7, 172.18.0.1', '172.18.0.3')).toBe('203.0.113.7')
  })

  test('an address a client wrote itself, ahead of the real one, is not believed', () => {
    expect(clientAddress('198.51.100.9, 203.0.113.7, 172.18.0.1')).toBe('203.0.113.7')
  })

  test('only proxies in the chain — the outer proxy sent none — is the first of them', () => {
    expect(clientAddress('172.18.0.1', '172.18.0.3')).toBe('172.18.0.1')
  })

  test('no header at all — the API reached directly, in development — is the connection', () => {
    expect(clientAddress(undefined, '127.0.0.1')).toBe('127.0.0.1')
    expect(clientAddress('', '::1')).toBe('::1')
  })

  test('nothing to go on is one address of its own, never an empty one', () => {
    expect(clientAddress()).toBe('unknown')
  })
})

describe("isPrivateAddress, as Caddy's private_ranges", () => {
  test.each([
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['::1', true],
    ['fd12:3456::1', true],
    ['::ffff:172.18.0.2', true],
    ['203.0.113.7', false],
    ['2001:db8::1', false],
    ['not an address', false],
  ])('%s → %p', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected)
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
