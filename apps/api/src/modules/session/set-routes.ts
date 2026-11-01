import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  Id,
  IDEMPOTENCY_KEY_HEADER,
  LogSetHeaders,
  LogSetInput,
  RestChange,
  SetLog,
  SetLogUpdate,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { logSet } from './log-set.ts'
import { amendLog, changeRest, removeLog } from './write-sets.ts'

const params = z.object({ id: Id })
const logParams = z.object({ id: Id, logId: Id })

/**
 * A session's sets — logged, corrected, removed — and the rest it keeps running after them (#38):
 * every write here goes through `writeSets`, which works the rest out again.
 */
export const setRoutes = new Elysia({ prefix: '/sessions', tags: ['sessions'] })
  .use(authPlugin)
  .guard({ auth: true })
  .post(
    '/:id/logs',
    ({ caller, params: { id }, body, headers }) =>
      logSet(caller, id, body, headers[IDEMPOTENCY_KEY_HEADER]),
    {
      params,
      body: LogSetInput,
      headers: LogSetHeaders,
      response: SetLog,
      detail: {
        summary: 'Record one performed set',
        description:
          'An `Idempotency-Key` header (a UUID) makes it safe to retry: a key already stored in ' +
          'the session is answered with the stored set, never logged twice.',
      },
    },
  )
  .patch(
    '/:id/logs/:logId',
    ({ caller, params: { id, logId }, body }) => amendLog(caller, id, logId, body),
    {
      params: logParams,
      body: SetLogUpdate,
      response: SetLog,
      detail: {
        summary:
          'Correct a set — what it measured, how hard it was, whether a warm-up — in progress or finished',
      },
    },
  )
  .delete(
    '/:id/logs/:logId',
    async ({ caller, params: { id, logId } }) => {
      await removeLog(caller, id, logId)
      return { ok: true }
    },
    { params: logParams, detail: { summary: 'Remove a set: an undo, or a past mistake fixed' } },
  )
  .post(
    '/:id/rest',
    async ({ caller, params: { id }, body }) => {
      await changeRest(caller, id, body)
      return { ok: true }
    },
    { params, body: RestChange, detail: { summary: 'Add 30 s to the rest running, or skip it' } },
  )
