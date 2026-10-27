import { z } from 'zod'
import { Id, NonEmptyString, Timestamp } from './primitives.ts'
import { User } from './user.ts'
import { formatDay } from './week.ts'

/**
 * What is known about a person, written down to be remembered when their training is planned
 * (#41): an injury, a preference, what they said of a plan, a week away. Read by them and by
 * whoever reads their training; written by them or a coach of theirs. See GLOSSARY.md, "Athlete
 * note", and docs/adr/0021-coaching-through-groups.md.
 */

/** As many as a person keeps — enough for what is still true, few enough to read before planning. */
export const NOTES_PER_ATHLETE = 100

/** `POST` and `PATCH` alike: a note is its words, and nothing else. */
export const AthleteNoteInput = z.strictObject({
  text: NonEmptyString.max(4000).describe(
    'One fact worth remembering when their training is planned, in plain words',
  ),
})
export type AthleteNoteInput = z.output<typeof AthleteNoteInput>

export const AthleteNote = z.object({
  id: Id,
  text: z.string(),
  /** Who wrote it — null once their account is gone: "a former coach". */
  author: User.pick({ id: true, displayName: true }).nullable(),
  writtenAt: Timestamp,
  /** Null until its words are changed. */
  editedAt: Timestamp.nullable(),
  /** Only its author changes its words. */
  canEdit: z.boolean(),
  /** Its author removes it, and so does the person it is about. */
  canDelete: z.boolean(),
})
export type AthleteNote = z.output<typeof AthleteNote>

/** Who wrote it, to the person reading it: `You`, their name, or `A former coach`. */
export const noteAuthor = (note: AthleteNote, readerId: string): string => {
  if (note.author === null) return 'A former coach'
  return note.author.id === readerId ? 'You' : note.author.displayName
}

/** `Sam · Mon 12 Oct`, and `· edited Wed 14 Oct` once changed: who wrote it, and when. */
export const noteByline = (note: AthleteNote, readerId: string): string => {
  const written = `${noteAuthor(note, readerId)} · ${formatDay(new Date(note.writtenAt))}`
  return note.editedAt === null
    ? written
    : `${written} · edited ${formatDay(new Date(note.editedAt))}`
}
