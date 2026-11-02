import { describe, expect, test } from 'bun:test'
import { DEFAULT_GROUP_SLUG, sayGroup } from './group.ts'

const words = { personal: 'mine', library: 'library' } as const

describe('sayGroup', () => {
  test('a personal group is said in the words for the caller’s own, not by its name', () => {
    expect(sayGroup({ kind: 'personal', slug: 'valerio', name: 'valerio' }, words)).toBe('mine')
  })

  test('the starter library is said as the library, not by its name', () => {
    expect(sayGroup({ kind: 'shared', slug: DEFAULT_GROUP_SLUG, name: 'cedo' }, words)).toBe(
      'library',
    )
  })

  test('any other group is said by its name', () => {
    expect(sayGroup({ kind: 'shared', slug: 'coaching', name: 'Coaching' }, words)).toBe(
      'Coaching',
    )
  })
})
