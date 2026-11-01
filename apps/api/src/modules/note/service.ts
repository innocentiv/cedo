import { type SQL, count, desc, eq, sql } from 'drizzle-orm'
import { type AthleteNote, type AthleteNoteInput, NOTES_PER_ATHLETE } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { athleteNotes, users } from '../../db/schema.ts'
import { conflict, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { athleteRecords } from '../athlete-record/records.ts'
import { type Training, ownOrCoached } from '../coaching/training.ts'

/**
 * Athlete notes (#41): about the caller, or — given `athleteId` — about an athlete they coach. An
 * athlete record (../athlete-record/records.ts): read, written and removed as every one is. What is
 * a note's own: at most `NOTES_PER_ATHLETE` about anyone, and its words, which only its author
 * changes. Each route and MCP tool calls these, so whoever asks is told the same. See GLOSSARY.md,
 * "Athlete note", and docs/adr/0021-coaching-through-groups.md.
 */

const notes = athleteRecords(athleteNotes, 'note')

/** Notes about them, with who wrote each — `and` more, to narrow it to one. */
const select = (training: Training, ...more: SQL[]) =>
  db
    .select({
      id: athleteNotes.id,
      text: athleteNotes.text,
      writtenAt: athleteNotes.writtenAt,
      editedAt: athleteNotes.editedAt,
      ...notes.authorColumns,
    })
    .from(athleteNotes)
    .leftJoin(users, notes.byAuthor)
    .where(notes.of(training, ...more))

type Row = Awaited<ReturnType<typeof select>>[number]

const toNote = (training: Training, row: Row): AthleteNote => ({
  id: row.id,
  text: row.text,
  writtenAt: row.writtenAt.toISOString(),
  editedAt: row.editedAt?.toISOString() ?? null,
  canEdit: row.authorId === training.reader.userId,
  ...notes.authored(training, row),
})

/** Every note about them, newest first — at most `NOTES_PER_ATHLETE`, so never paged. */
export async function list(caller: Caller, athleteId?: string): Promise<AthleteNote[]> {
  const training = await ownOrCoached(caller, athleteId)
  const rows = await select(training).orderBy(desc(athleteNotes.writtenAt), desc(athleteNotes.id))
  return rows.map((row) => toNote(training, row))
}

async function one(training: Training, id: string): Promise<AthleteNote> {
  const [row] = await select(training, eq(athleteNotes.id, id)).limit(1)
  if (row === undefined) throw notFound('note')
  return toNote(training, row)
}

/**
 * Written down, unless they have `NOTES_PER_ATHLETE` already. Their row is locked first, so two
 * notes written at once take turns at the count rather than both passing it.
 */
export async function create(
  caller: Caller,
  athleteId: string | undefined,
  input: AthleteNoteInput,
): Promise<AthleteNote> {
  const training = await ownOrCoached(caller, athleteId)
  const id = await db.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, training.athleteId))
      .for('update')
    const [kept] = await tx.select({ n: count() }).from(athleteNotes).where(notes.of(training))
    if ((kept?.n ?? 0) >= NOTES_PER_ATHLETE) {
      throw conflict('Remove a note that is no longer true first')
    }
    const [written] = await tx
      .insert(athleteNotes)
      .values({
        athleteId: training.athleteId,
        authorId: training.reader.userId,
        text: input.text,
      })
      .returning({ id: athleteNotes.id })
    return notes.inserted(written).id
  })
  return await one(training, id)
}

/** Its words changed — by its author only. Anyone else is told there is no such note. */
export async function update(
  caller: Caller,
  athleteId: string | undefined,
  id: string,
  input: AthleteNoteInput,
): Promise<AthleteNote> {
  const training = await ownOrCoached(caller, athleteId)
  const changed = await db
    .update(athleteNotes)
    .set({ text: input.text, editedAt: sql`now()` })
    .where(
      notes.of(
        training,
        eq(athleteNotes.id, id),
        eq(athleteNotes.authorId, training.reader.userId),
      ),
    )
    .returning({ id: athleteNotes.id })
  if (changed.length === 0) throw notFound('note')
  return await one(training, id)
}

/** Removed — by its author, or by the person it is about. */
export const remove = notes.remove
