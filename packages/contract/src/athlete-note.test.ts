import { describe, expect, test } from 'bun:test'
import { AthleteNoteInput, type AthleteNote, noteAuthor, noteByline } from './athlete-note.ts'

const sam = '00000000-0000-4000-8000-000000000001'
const coach = '00000000-0000-4000-8000-000000000002'

const note = (over: Partial<AthleteNote> = {}): AthleteNote => ({
  id: '00000000-0000-4000-8000-000000000003',
  text: 'Left shoulder hurts on overhead work',
  author: { id: coach, displayName: 'Coach Kim' },
  writtenAt: new Date(2026, 9, 12, 9).toISOString(),
  editedAt: null,
  canEdit: false,
  canDelete: true,
  ...over,
})

describe('an athlete note', () => {
  test('is words: trimmed, never empty, at most 4000 characters, and nothing else', () => {
    expect(AthleteNoteInput.parse({ text: '  Away 10–17 Nov  ' })).toEqual({
      text: 'Away 10–17 Nov',
    })
    for (const text of ['', '   ', 'x'.repeat(4001)]) {
      expect(AthleteNoteInput.safeParse({ text }).success).toBe(false)
    }
    expect(AthleteNoteInput.safeParse({ text: 'x', athlete: sam }).success).toBe(false)
  })

  test('says who wrote it to whoever reads it: you, their name, or a former coach', () => {
    expect(noteAuthor(note(), sam)).toBe('Coach Kim')
    expect(noteAuthor(note(), coach)).toBe('You')
    expect(noteAuthor(note({ author: null }), sam)).toBe('A former coach')
  })

  test('says when it was written, and when it was changed once it has been', () => {
    expect(noteByline(note(), sam)).toBe('Coach Kim · Mon 12 Oct')
    expect(noteByline(note({ editedAt: new Date(2026, 9, 14, 9).toISOString() }), coach)).toBe(
      'You · Mon 12 Oct · edited Wed 14 Oct',
    )
  })
})
