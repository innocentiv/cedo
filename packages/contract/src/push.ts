import { z } from 'zod'

/**
 * The push services a browser subscribes through — Apple's, Google's, Mozilla's, Microsoft's. The
 * server posts to a subscription's endpoint, so one anywhere else would have it post wherever it was
 * told: inside its own network, too.
 */
const PUSH_SERVICES = [
  'push.apple.com',
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'notify.windows.com',
] as const

const onPushService = (endpoint: string): boolean => {
  const host = new URL(endpoint).hostname
  return PUSH_SERVICES.some((service) => host === service || host.endsWith(`.${service}`))
}

/**
 * A device asking to be told when a rest is over (#38): where its browser's push service takes a
 * message, and the keys one is sealed with — `PushSubscription.toJSON()`, as the browser gives it.
 */
export const PushSubscriptionInput = z.object({
  endpoint: z
    .url({ protocol: /^https$/u })
    .max(2048)
    .refine(onPushService, 'Not a push service a browser subscribes through'),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
})
export type PushSubscriptionInput = z.output<typeof PushSubscriptionInput>

/** `DELETE /push/subscriptions?endpoint=`: this device, told no more. */
export const PushUnsubscribe = PushSubscriptionInput.pick({ endpoint: true })
export type PushUnsubscribe = z.output<typeof PushUnsubscribe>

/** The key a browser subscribes with: this instance's public push key. */
export const PushKey = z.object({ publicKey: z.string() })
export type PushKey = z.output<typeof PushKey>

/** What a rest alert carries to the device: what it says, and the session it opens. */
export const RestAlert = z.object({ title: z.string(), body: z.string(), url: z.string() })
export type RestAlert = z.output<typeof RestAlert>
