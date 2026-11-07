import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Failed logins, kept only while they count (#72, ADR-0031): the window is
 * `modules/auth/login-limit.ts`'s, and each new failure first prunes those older than it. A
 * successful login clears its own address and username's. Not owned by anyone.
 */
export const loginFailures = pgTable(
  'login_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    address: text('address').notNull(),
    username: text('username').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('login_failures_address_at_idx').on(t.address, t.at),
    index('login_failures_address_username_at_idx').on(t.address, t.username, t.at),
    // The prune: everything older than the window, whoever it was.
    index('login_failures_at_idx').on(t.at),
  ],
)
