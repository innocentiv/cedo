import { type SQL, and, eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { RecordAuthorship } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { users } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type Training, ownOrCoached } from '../coaching/training.ts'

/**
 * Athlete records (GLOSSARY.md): what is kept about a person — athlete notes, weigh-ins. PERSONAL,
 * as sessions are: about one person, read by them and by whoever reads their training (`Training`),
 * written by them or a coach of theirs, removed by whoever wrote it or by the person it is about.
 * The rules every kind keeps alike are here, bound to its table once; what is a kind's own — a
 * note's words, a weigh-in's one a day — is its own module's. See docs/02-conventions.md.
 */

/** What an athlete record's table has: whom it is about, and who wrote it. */
type RecordTable = PgTable & {
  readonly id: PgColumn
  readonly athleteId: PgColumn
  readonly authorId: PgColumn
}

/** A row read with `authorColumns`: who wrote it, and their name — null once their account is gone. */
interface AuthoredRow {
  readonly authorId: string | null
  readonly authorName: string | null
}

/** The rules of one kind of athlete record, bound to its table. */
export interface AthleteRecords<T extends RecordTable> {
  /**
   * This athlete's rows — `and` more, to narrow them: where every read, change and removal of them
   * begins. An insert names the training's athlete itself.
   */
  readonly of: (training: Training, ...more: (SQL | undefined)[]) => SQL | undefined
  /** Who wrote it, projected — a user row carries its password hash — and joined by `byAuthor`. */
  readonly authorColumns: { authorId: T['authorId']; authorName: typeof users.displayName }
  /** LEFT JOINed: a record outlives its author's account. */
  readonly byAuthor: SQL
  /** What the reader is told of who wrote it, and whether they may remove it. */
  readonly authored: (training: Training, row: AuthoredRow) => RecordAuthorship
  /** Removed — by whoever wrote it, or by the person it is about. Anyone else: there is none. */
  readonly remove: (caller: Caller, athleteId: string | undefined, id: string) => Promise<void>
  /** Thrown, not defaulted: an empty id would reach a uuid column as a 500 (ownable/service.ts). */
  readonly inserted: <R>(row: R | undefined) => R
}

/** `kind` names it in a 404, and in an error. */
export function athleteRecords<T extends RecordTable>(table: T, kind: string): AthleteRecords<T> {
  const of = (training: Training, ...more: (SQL | undefined)[]) =>
    and(eq(table.athleteId, training.athleteId), ...more)
  return {
    of,
    authorColumns: { authorId: table.authorId, authorName: users.displayName },
    byAuthor: eq(users.id, table.authorId),

    authored: (training: Training, row: AuthoredRow): RecordAuthorship => ({
      author:
        row.authorId === null || row.authorName === null
          ? null
          : { id: row.authorId, displayName: row.authorName },
      canDelete:
        row.authorId === training.reader.userId || training.athleteId === training.reader.userId,
    }),

    remove: async (caller: Caller, athleteId: string | undefined, id: string): Promise<void> => {
      const training = await ownOrCoached(caller, athleteId)
      const theirs = training.athleteId === training.reader.userId
      const removed = await db
        .delete(table)
        .where(
          of(
            training,
            eq(table.id, id),
            theirs ? undefined : eq(table.authorId, training.reader.userId),
          ),
        )
        .returning({ id: table.id })
      if (removed.length === 0) throw notFound(kind)
    },

    inserted: <R>(row: R | undefined): R => {
      if (row === undefined) throw new Error(`A ${kind} was written and returned nothing`)
      return row
    },
  }
}
