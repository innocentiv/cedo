import { describe, expect, test } from 'bun:test'
import { alertOf, keyBytes } from './rest-alert.ts'

describe('a pushed rest alert (#38)', () => {
  test('is read as the server wrote it', () => {
    expect(
      alertOf({ title: 'Rest over', body: 'Squat — Set 2 of 3', url: '/today/session/abc' }),
    ).toEqual({ title: 'Rest over', body: 'Squat — Set 2 of 3', url: '/today/session/abc' })
  })

  test('opens this app, never another site', () => {
    expect(alertOf({ title: 'T', body: 'B', url: 'https://evil.example/' })?.url).toBe('/')
    expect(alertOf({ title: 'T', body: 'B', url: '//evil.example/' })?.url).toBe('/')
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
