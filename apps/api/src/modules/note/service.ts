import { type SQL, and, count, desc, eq, sql } from 'drizzle-orm'
import { type AthleteNote, type AthleteNoteInput, NOTES_PER_ATHLETE } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { athleteNotes, users } from '../../db/schema.ts'
import { conflict, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { ownOrCoached } from '../coaching/athletes.ts'
import type { Training } from '../session/service.ts'

/**
 * Athlete notes (#41): about the caller, or — given `athleteId` — about an athlete they coach. Read
 * by both, written by both: the one thing a coach writes of an athlete's, and none of their
 * training. Only the author changes a note's words; the author or the person it is about removes
 * it. Each route and MCP tool calls these, so whoever asks is told the same. See GLOSSARY.md,
 * "Athlete note", and docs/adr/0021-coaching-through-groups.md.
 */

/** Notes about them, with who wrote each — `and` more, to narrow it to one. */
const select = (training: Training, ...more: SQL[]) =>
  db
    .select({
      id: athleteNotes.id,
      text: athleteNotes.text,
      writtenAt: athleteNotes.writtenAt,
      editedAt: athleteNotes.editedAt,
      authorId: athleteNotes.authorId,
      // Projected: a user row carries its password hash.
      authorName: users.displayName,
    })
    .from(athleteNotes)
    .leftJoin(users, eq(users.id, athleteNotes.authorId))
    .where(and(eq(athleteNotes.athleteId, training.athleteId), ...more))

type Row = Awaited<ReturnType<typeof select>>[number]

const toNote = (training: Training, row: Row): AthleteNote => {
  const mine = row.authorId === training.reader.userId
  return {
    id: row.id,
    text: row.text,
    author:
      row.authorId === null || row.authorName === null
        ? null
        : { id: row.authorId, displayName: row.authorName },
    writtenAt: row.writtenAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    canEdit: mine,
    canDelete: mine || training.athleteId === training.reader.userId,
  }
}

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
    const [kept] = await tx
      .select({ n: count() })
      .from(athleteNotes)
      .where(eq(athleteNotes.athleteId, training.athleteId))
    if ((kept?.n ?? 0) >= NOTES_PER_ATHLETE) {
      throw conflict('Remove a note that is no longer true first')
    }
    const [written] = await tx
      .insert(athleteNotes)
      .values({ athleteId: training.athleteId, authorId: caller.userId, text: input.text })
      .returning({ id: athleteNotes.id })
    // Thrown, not defaulted: an empty id would reach a uuid column as a 500 (ownable/service.ts).
    if (written === undefined) throw new Error('A note was inserted and returned nothing')
    return written.id
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
  await written(
    db
      .update(athleteNotes)
      .set({ text: input.text, editedAt: sql`now()` })
      .where(about(training, id, eq(athleteNotes.authorId, caller.userId)))
      .returning({ id: athleteNotes.id }),
  )
  return await one(training, id)
}

/** Removed — by its author, or by the person it is about. */
export async function remove(
  caller: Caller,
  athleteId: string | undefined,
  id: string,
): Promise<void> {
  const training = await ownOrCoached(caller, athleteId)
  const theirs = training.athleteId === caller.userId
  await written(
    db
      .delete(athleteNotes)
      .where(about(training, id, theirs ? undefined : eq(athleteNotes.authorId, caller.userId)))
      .returning({ id: athleteNotes.id }),
  )
}

/** The note `id` about them, and — when given — only if `who` may change it. */
const about = (training: Training, id: string, who: SQL | undefined) =>
  and(eq(athleteNotes.athleteId, training.athleteId), eq(athleteNotes.id, id), who)

const written = async (statement: Promise<readonly unknown[]>): Promise<void> => {
  if ((await statement).length === 0) throw notFound('note')
}
