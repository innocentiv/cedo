import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
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
     * A person's notes. Their order is a sort of at most 100 (`NOTES_PER_ATHLETE`), which the
     * planner rightly prefers to walking a wider index in order: `bun run perf` saw it do so.
     */
    index('athlete_notes_athlete_idx').on(t.athleteId),
  ],
)

/**
 * A person's bodyweight on one day (#42) — another that day replaces it. Kept and read as athlete
 * notes are: PERSONAL, written by them or by a coach of theirs. See GLOSSARY.md, "Weigh-in".
 */
export const weighIns = pgTable(
  'weigh_ins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who took it: null once their account is gone. */
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** On the person's own calendar, as their device said it: never the server's day. */
    day: date('day', { mode: 'string' }).notNull(),
    weightG: integer('weight_g').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One a day, which a second that day replaces; and a period's, newest first. */
    uniqueIndex('weigh_ins_athlete_day_idx').on(t.athleteId, t.day),
  ],
)
