import { describe, expect, test } from 'bun:test'
import { Slug } from '@cedo/contract'
import { slugify } from './slug.ts'

/**
 * `Group.slug` is validated on every response, and `GroupMembership` appears in both `GET /groups`
 * and `GET /auth/me` — so a single invalid slug 422s those routes permanently for every member of
 * that group. This is a pure function, so it can be hammered.
 */
describe('slugify always produces a valid Slug', () => {
  const NAMES = [
    'Squad',
    'Monday Push Day For The Whole Crew Plus Extras',
    'a'.repeat(80),
    'Тренировки',
    '💪',
    '!!!',
    '   ',
    '-leading-and-trailing-',
    'Multiple   Spaces',
    'Mixed-CASE_and.punctuation!',
    'A',
    '1',
    'x'.repeat(39) + ' y',
    'Push / Pull / Legs',
    '日本語のグループ',
  ]

  test.each(NAMES)('%p', (name) => {
    const slug = slugify(name)
    const result = Slug.safeParse(slug)
    if (!result.success)
      throw new Error(`slugify(${JSON.stringify(name)}) -> ${slug} is not a valid Slug`)
    expect(result.success).toBe(true)
  })

  test('is unique across repeated calls with the same name', () => {
    const slugs = new Set(Array.from({ length: 200 }, () => slugify('Squad')))
    expect(slugs.size).toBe(200)
  })

  test('random unicode never produces an invalid slug', () => {
    for (let i = 0; i < 500; i++) {
      const name = String.fromCodePoint(
        ...Array.from({ length: 1 + (i % 20) }, () => 32 + Math.floor(Math.random() * 60_000)),
      )
      expect(Slug.safeParse(slugify(name)).success).toBe(true)
    }
  })
})
