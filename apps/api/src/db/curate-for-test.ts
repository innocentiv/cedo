import { and, eq } from 'drizzle-orm'
import { DEFAULT_GROUP_SLUG } from '@cedo/contract'
import { closeDatabase, db } from './client.ts'
import { groupMembers, groups, users } from './schema.ts'
import { env } from '../env.ts'

/**
 * Makes an account the curator of the test database: `bun run …/curate-for-test.ts <username>`.
 *
 * The end-to-end harness's way to have a curator (#71), across the process boundary as
 * `prepare-test-db.ts` is: `apps/app` never imports from `apps/api`. A real instance gets its
 * curator from its first account, or `CEDO_CURATOR_USERNAME`; neither suits a database the whole
 * e2e run shares.
 */
if (env.NODE_ENV !== 'test') {
  throw new Error('curate-for-test is only for NODE_ENV=test. It makes an account a curator.')
}

const username = process.argv[2]
if (username === undefined) throw new Error('usage: curate-for-test.ts <username>')

const [user] = await db.select({ id: users.id }).from(users).where(eq(users.username, username))
const [shared] = await db
  .select({ id: groups.id })
  .from(groups)
  .where(eq(groups.slug, DEFAULT_GROUP_SLUG))
if (user === undefined || shared === undefined) {
  throw new Error(`No account ${username}, or no shared library, in the test database.`)
}
await db
  .update(groupMembers)
  .set({ role: 'editor' })
  .where(and(eq(groupMembers.groupId, shared.id), eq(groupMembers.userId, user.id)))
await closeDatabase()
