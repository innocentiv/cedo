import { z } from 'zod'
import { User } from './user.ts'

/**
 * Athlete records (GLOSSARY.md): what is kept about a person — athlete notes, weigh-ins — read by
 * them and by whoever reads their training, written by them or a coach of theirs. What every one
 * says of who wrote it, and whether the reader may remove it.
 */
export const RecordAuthorship = z.object({
  /** Who wrote it — null once their account is gone: "a former coach". */
  author: User.pick({ id: true, displayName: true }).nullable(),
  /** Its author removes it, and so does the person it is about. */
  canDelete: z.boolean(),
})
export type RecordAuthorship = z.output<typeof RecordAuthorship>
