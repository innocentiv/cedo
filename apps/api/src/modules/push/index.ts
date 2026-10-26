import { Elysia } from 'elysia'
import { PushKey, PushSubscriptionInput, PushUnsubscribe } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as PushService from './service.ts'

/** The devices a person is told on when a rest is over (#38). */
export const pushRoutes = new Elysia({ prefix: '/push', tags: ['push'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/key', () => PushService.publicKey(), {
    response: PushKey,
    detail: { summary: "This instance's public push key, to subscribe a device with" },
  })
  .post(
    '/subscriptions',
    async ({ caller, body }) => {
      await PushService.subscribe(caller, body)
      return { ok: true }
    },
    { body: PushSubscriptionInput, detail: { summary: 'Tell this device when a rest is over' } },
  )
  .delete(
    '/subscriptions',
    async ({ caller, body }) => {
      await PushService.unsubscribe(caller, body)
      return { ok: true }
    },
    { body: PushUnsubscribe, detail: { summary: 'Tell this device no more' } },
  )
