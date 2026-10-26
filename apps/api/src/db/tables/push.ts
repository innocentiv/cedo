import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity.ts'

/**
 * A device that asked to be told when a rest is over (#38): where its browser's push service takes
 * a message, and the keys a message to it is sealed with. A person has one per device they allowed
 * it on; a push service that answers "gone" removes it.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Unique: the browser's own address for this device, said again on every subscribe. */
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
)

/**
 * Secrets this instance made for itself, by name — its push key pair (#38), made on first start so
 * someone self-hosting has nothing to set up. Never sent anywhere but where it signs.
 */
export const instanceSecrets = pgTable('instance_secrets', {
  name: text('name').primaryKey(),
  value: text('value').notNull(),
})
