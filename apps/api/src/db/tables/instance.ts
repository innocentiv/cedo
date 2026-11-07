import { sql } from 'drizzle-orm'
import { boolean, check, pgEnum, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { SIGN_UP_STATES } from '@cedo/contract'

/** The contract's own list, so a state added there is a migration here. */
export const signUpState = pgEnum('sign_up_state', SIGN_UP_STATES)

/**
 * The instance's own settings (#71): one row, ever, which the check on `one` enforces. Kept in the
 * database rather than the environment so the curator can open sign-up for testers and close it
 * again without a deploy. Not owned by anyone: only the curator writes it, through
 * `modules/instance/service.ts`. A missing row reads as sign-up closed. See ADR-0029.
 */
export const instanceSettings = pgTable(
  'instance_settings',
  {
    one: boolean('one').primaryKey().default(true),
    signUp: signUpState('sign_up').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('instance_settings_one_row', sql`${t.one}`)],
)
