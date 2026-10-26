import { Elysia } from 'elysia'
import { z } from 'zod'
import { Id, RestChange } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { changeRest, removeSet } from './service.ts'

/**
 * The rest a session has running, as the server keeps it (#38): +30 s, or skip — and a set removed,
 * which is the session's, here because the rest after it is worked out again.
 */
export const restRoutes = new Elysia({ prefix: '/sessions', tags: ['sessions'] })
  .use(authPlugin)
  .guard({ auth: true })
  .post(
    '/:id/rest',
    async ({ caller, params: { id }, body }) => {
      await changeRest(caller, id, body)
      return { ok: true }
    },
    {
      params: z.object({ id: Id }),
      body: RestChange,
      detail: { summary: 'Add 30 s to the rest running, or skip it' },
    },
  )
  .delete(
    '/:id/logs/:logId',
    async ({ caller, params: { id, logId } }) => {
      await removeSet(caller, id, logId)
      return { ok: true }
    },
    {
      params: z.object({ id: Id, logId: Id }),
      detail: { summary: 'Remove a set: an undo, or a past mistake fixed' },
    },
  )
