import { describe, expect, test } from 'bun:test'
import { nextDayOf } from './today.ts'

const days = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('the next day (GLOSSARY.md)', () => {
  test('is the one after the day trained last, in plan order', () => {
    expect(nextDayOf(days, 'a')?.id).toBe('b')
    expect(nextDayOf(days, 'b')?.id).toBe('c')
  })

  test('goes back to the first after the last', () => {
    expect(nextDayOf(days, 'c')?.id).toBe('a')
  })

  test('starts the plan again when the day trained last is gone from it, or there was none', () => {
    expect(nextDayOf(days, 'removed')?.id).toBe('a')
    expect(nextDayOf(days, null)?.id).toBe('a')
  })

  test('is none in a plan with no days', () => {
    expect(nextDayOf<{ id: string }>([], 'a')).toBeUndefined()
  })
})
