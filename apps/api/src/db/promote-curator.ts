import { and, eq, ne } from 'drizzle-orm'
import { db } from './client.ts'
import { groupMembers, users } from './schema.ts'
import { env } from '../env.ts'

/**
 * Makes `CEDO_CURATOR_USERNAME` an editor of the shared `cedo` group, at every seed run.
 *
 * Deprecated (ADR-0029): a fresh instance's first account is its curator. This remains for an
 * instance set up before that, which may have none: the system account owns the library's rows but
 * is never a member of its group, and every other account joins it as a `reader`. Idempotent, and a
 * no-op when the variable is unset or names an account that does not exist yet — register first,
 * then restart. See docs/07-mcp.md.
 */
export async function promoteCurator(
  sharedGroupId: string,
  username = env.CEDO_CURATOR_USERNAME,
): Promise<boolean> {
  if (username === undefined) return false

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username.toLowerCase()))
    .limit(1)
  if (user === undefined) {
    console.warn(
      `CEDO_CURATOR_USERNAME='${username}' does not exist yet — register that account, then restart to grant it curator rights.`,
    )
    return false
  }

  // Only an instance with no curator yet takes one this way. Once it has one — its first account,
  // or this account on an earlier boot — the variable names nobody else: on an instance letting
  // testers in, whoever registered that username would otherwise curate it at the next restart.
  const [another] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, sharedGroupId),
        eq(groupMembers.role, 'editor'),
        ne(groupMembers.userId, user.id),
      ),
    )
    .limit(1)
  if (another !== undefined) {
    console.warn(
      `CEDO_CURATOR_USERNAME='${username}' is ignored: this instance already has a curator (ADR-0029).`,
    )
    return false
  }

  await db
    .insert(groupMembers)
    .values({ groupId: sharedGroupId, userId: user.id, role: 'editor' })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.userId],
      set: { role: 'editor' },
    })
  return true
}
