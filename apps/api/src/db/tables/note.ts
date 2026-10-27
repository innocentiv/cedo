import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity.ts'

/**
 * What is known about a person, written down for planning their training (#41): by them, or by a
 * coach of theirs. PERSONAL, as sessions are — about one person, never shared or transferred, read
 * by a coach only through `Training`. See GLOSSARY.md, "Athlete note".
 */
export const athleteNotes = pgTable(
  'athlete_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Whom it is about: their notes go with their account. */
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who wrote it. A coach's stay when they stop coaching; null once their account is gone. */
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    text: text('text').notNull(),
    writtenAt: timestamp('written_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null until its words are changed. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * A person's notes, newest first, in one index walk. `.nullsFirst()` as on
     * workout_sessions_user_time_idx: Drizzle's `.desc()` is NULLS LAST, which `ORDER BY … DESC`
     * cannot walk.
     */
    index('athlete_notes_athlete_time_idx').on(
      t.athleteId,
      t.writtenAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
  ],
)
