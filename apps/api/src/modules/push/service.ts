import { and, desc, eq, notInArray } from 'drizzle-orm'
import type { PushKey, PushSubscriptionInput, PushUnsubscribe } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { pushSubscriptions } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { pushKeys } from './keys.ts'

/**
 * The devices a person is told on when a rest is over (#38): this instance's public key to subscribe
 * with, a device subscribed, and one told no more.
 */

export const publicKey = async (): Promise<PushKey> => ({ publicKey: (await pushKeys()).publicKey })

/**
 * A device subscribed — when turned on, and again on every open of the app, harmlessly: the
 * browser's endpoint is the device, and a device signed in to another account now is that account's.
 * Turned on most lately counts as newest.
 */
export async function subscribe(caller: Caller, input: PushSubscriptionInput): Promise<void> {
  const values = {
    userId: caller.userId,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    createdAt: new Date(),
  }
  await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
  // A few devices a person, at most: each alert is a post to each, so the oldest go past the cap.
  const kept = db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, caller.userId))
    .orderBy(desc(pushSubscriptions.createdAt))
    .limit(DEVICES_EACH)
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, caller.userId), notInArray(pushSubscriptions.id, kept)))
}

/** How many devices a person is told on: a phone, a tablet, a laptop or two. */
export const DEVICES_EACH = 5

/** A device told no more — one of the caller's own; another's is not theirs to stop. */
export async function unsubscribe(caller: Caller, { endpoint }: PushUnsubscribe): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.userId, caller.userId), eq(pushSubscriptions.endpoint, endpoint)),
    )
}
