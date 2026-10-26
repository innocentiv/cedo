import { describe, expect, test } from 'bun:test'
import { alertOf, alertsStateOf, keyBytes } from './rest-alert.ts'

describe('a pushed rest alert (#38)', () => {
  test('is read as the server wrote it', () => {
    expect(
      alertOf({ title: 'Rest over', body: 'Squat — Set 2 of 3', url: '/today/session/abc' }),
    ).toEqual({ title: 'Rest over', body: 'Squat — Set 2 of 3', url: '/today/session/abc' })
  })

  test('opens this app, never another site', () => {
    expect(alertOf({ title: 'T', body: 'B', url: 'https://evil.example/' })?.url).toBe('/')
    expect(alertOf({ title: 'T', body: 'B', url: '//evil.example/' })?.url).toBe('/')
    expect(alertOf({ title: 'T', body: 'B', url: '/\\evil.example/' })?.url).toBe('/')
  })

  test('is not one when anything is missing', () => {
    expect(alertOf(null)).toBeNull()
    expect(alertOf({ title: 'Rest over' })).toBeNull()
  })
})

describe("the server's key, as a device subscribes with it", () => {
  test('base64url to the bytes it stands for', () => {
    expect([...keyBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239])
  })
})

describe('rest alerts on this device', () => {
  const device = { supported: true, permission: 'granted' as const, subscribed: true }
  test('on when allowed and subscribed; off when allowed and not — signed out, or turned off', () => {
    expect(alertsStateOf(device)).toBe('on')
    expect(alertsStateOf({ ...device, subscribed: false })).toBe('off')
  })
  test('asked until answered, blocked once refused, and nothing where it cannot be', () => {
    expect(alertsStateOf({ ...device, permission: 'default' })).toBe('ask')
    expect(alertsStateOf({ ...device, permission: 'denied' })).toBe('blocked')
    expect(alertsStateOf({ ...device, supported: false })).toBe('unsupported')
  })
})
