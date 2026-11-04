import { describe, expect, test } from 'bun:test'
import { EntryCue, MAX_CUE_LENGTH } from './cue.ts'

/** What the coach or the AI tells the athlete about one entry: "pause 1 s at the chest". */
describe('an entry’s cue', () => {
  test('is trimmed, and blank is none', () => {
    expect(EntryCue.parse('  Pause at the chest ')).toBe('Pause at the chest')
    expect(EntryCue.parse('   ')).toBeNull()
    expect(EntryCue.parse(null)).toBeNull()
  })

  test('is one line: every run of whitespace, newlines included, is one space', () => {
    expect(EntryCue.parse('Brace.\nDrive through\t\tthe heels.\r\n')).toBe(
      'Brace. Drive through the heels.',
    )
  })

  test('is measured once folded, so blank lines cost nothing', () => {
    const words = 'x'.repeat(MAX_CUE_LENGTH - 2)
    expect(EntryCue.safeParse(`${words}\n\n\n\nx`).success).toBe(true)
  })

  test(`holds at most ${MAX_CUE_LENGTH} characters`, () => {
    expect(EntryCue.safeParse('x'.repeat(MAX_CUE_LENGTH)).success).toBe(true)
    expect(EntryCue.safeParse('x'.repeat(MAX_CUE_LENGTH + 1)).success).toBe(false)
  })
})
