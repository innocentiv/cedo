import { and, eq, isNull, lte } from 'drizzle-orm'
import webpush from 'web-push'
import { db } from '../../db/client.ts'
import { pushSubscriptions, workoutSessions } from '../../db/schema.ts'
import { env } from '../../env.ts'
import { callerOfUser } from '../../plugins/auth.ts'
import { pushKeys } from './keys.ts'
import { restAlertFor } from './message.ts'

/**
 * Telling a person their rest is over (#38): once a second, the rests that have ended are claimed —
 * marked told in one statement, so two senders cannot both tell one — and each is pushed to every
 * device its athlete allowed it on. A rest that ended long ago, while the server was down, is
 * claimed and left untold: "rest over" an hour late helps nobody. See
 * docs/adr/0025-rest-kept-by-the-server.md.
 */

/** A device as a push is sealed for it. */
export interface Device {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

/** Whether a device took the push, or its push service says it is gone for good. */
export type Delivered = 'sent' | 'gone' | 'failed'
export type Deliver = (device: Device, payload: string) => Promise<Delivered>

/** How late a rest's end may be told: past this, the moment has gone. */
const STALE_MS = 5 * 60_000

export async function sendDueAlerts(now: Date, deliver: Deliver = webPush): Promise<number> {
  const due = await db
    .update(workoutSessions)
    .set({ restAlertedAt: now })
    .where(
      and(
        lte(workoutSessions.restEndsAt, now),
        isNull(workoutSessions.restAlertedAt),
        isNull(workoutSessions.endedAt),
      ),
    )
    .returning({
      id: workoutSessions.id,
      userId: workoutSessions.userId,
      endsAt: workoutSessions.restEndsAt,
    })
  const fresh = due.filter(
    (d) => d.endsAt !== null && now.getTime() - d.endsAt.getTime() < STALE_MS,
  )
  const told = await Promise.all(fresh.map(async (d) => await tell(d.userId, d.id, deliver)))
  return told.reduce((sum, n) => sum + n, 0)
}

/** One rest's alert, to every device of its athlete's. How many took it. */
async function tell(userId: string, sessionId: string, deliver: Deliver): Promise<number> {
  const devices = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
  if (devices.length === 0) return 0
  const caller = await callerOfUser(userId)
  if (caller === null) return 0
  const payload = JSON.stringify(await restAlertFor(caller, sessionId))
  const results = await Promise.all(
    devices.map(async (d) => {
      const result = await deliver({ endpoint: d.endpoint, keys: d }, payload)
      // Gone for good — the app removed, the permission taken back: told no more.
      if (result === 'gone')
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, d.id))
      return result
    }),
  )
  return results.filter((r) => r === 'sent').length
}

/** Through the device's push service, sealed with this instance's key pair. */
async function webPush(device: Device, payload: string): Promise<Delivered> {
  const { publicKey, privateKey } = await pushKeys()
  try {
    await webpush.sendNotification(device, payload, {
      vapidDetails: { subject: env.VAPID_SUBJECT, publicKey, privateKey },
      // Worth nothing a minute late, and wanted now.
      TTL: 60,
      urgency: 'high',
    })
    return 'sent'
  } catch (error: unknown) {
    // web-push rejects with its WebPushError, whose statusCode is the push service's answer.
    const status: unknown =
      typeof error === 'object' && error !== null ? Reflect.get(error, 'statusCode') : undefined
    if (status === 404 || status === 410) return 'gone'
    console.warn('A rest alert was not taken by its push service:', status)
    return 'failed'
  }
}

/** The sender, once a second, for the life of the process; each round waits for the last. */
export function startRestAlerts(): () => void {
  let busy = false
  const timer = setInterval(() => {
    if (busy) return
    busy = true
    sendDueAlerts(new Date())
      .catch((error: unknown) => {
        console.error('Rest alerts failed this round:', error)
      })
      .finally(() => {
        busy = false
      })
  }, 1000)
  return () => {
    clearInterval(timer)
  }
}
