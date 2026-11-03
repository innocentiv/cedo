import { sql } from 'drizzle-orm'
import { index, jsonb, pgEnum, pgTable, smallint, timestamp, uuid } from 'drizzle-orm/pg-core'
import { type Against, type Held, STEP_KINDS, type SetTarget } from '@cedo/contract'
import { users } from './identity.ts'
import { workoutSessions } from './log.ts'
import { workoutEntries } from './workout.ts'

export const stepKind = pgEnum('step_kind', STEP_KINDS)

/**
 * A person's target on an entry, kept as the steps that moved it (ADR-0026): one per finished
 * session the entry was trained in under a rule, or one set by hand. PERSONAL, as sessions are —
 * about one person, never shared — and read only by progression (docs/02-conventions.md). Their
 * target is their latest step, while what it was taken `against` stands as the plan does now.
 */
export const progressionSteps = pgTable(
  'progression_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Removed from the plan, the entry takes its steps with it; its logs stay, by exercise. */
    entryId: uuid('entry_id')
      .notNull()
      .references(() => workoutEntries.id, { onDelete: 'cascade' }),
    /** The session a `session` step judged. Deleted, its steps go before the later ones are re-taken. */
    sessionId: uuid('session_id').references(() => workoutSessions.id, { onDelete: 'cascade' }),
    kind: stepKind('kind').notNull(),
    /** The judged session's start, or the moment of a step set by hand: steps order as training did. */
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
    /** The target the session was asked, as the person was shown it. */
    from: jsonb('from').$type<SetTarget>().notNull(),
    /** The target it left: advanced, or `from` again when it held. */
    target: jsonb('target').$type<SetTarget>().notNull(),
    held: jsonb('held').$type<Held>(),
    /** Sessions cleared in a row toward the rule's `afterSuccesses`, after this one. */
    streak: smallint('streak').notNull().default(0),
    against: jsonb('against').$type<Against>().notNull(),
  },
  (t) => [
    /**
     * A person's target on an entry — their latest step — for a whole plan in one read, and the
     * steps from a corrected session onward.
     */
    index('progression_steps_target_idx').on(
      t.userId,
      t.entryId,
      t.takenAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('progression_steps_session_idx')
      .on(t.sessionId)
      .where(sql`${t.sessionId} is not null`),
  ],
)
