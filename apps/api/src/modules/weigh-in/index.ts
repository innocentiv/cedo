import { Elysia } from 'elysia'
import { z } from 'zod'
import { Bodyweight, Id, ReviewQuery, WeighIn, WeighInInput } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as WeighInService from './service.ts'

const one = z.object({ weighInId: Id })
const theirs = z.object({ id: Id })
const theirOne = z.object({ id: Id, weighInId: Id })

/**
 * Weigh-ins (#42): yours at `/weigh-ins`, and an athlete's you coach at `/athletes/:id/weigh-ins` —
 * written there as their notes are. Over the review's weeks, so a period reads alike everywhere.
 * Someone who does not share their training with you is a 404 on every route.
 */
export const weighInRoutes = new Elysia({ tags: ['weigh-ins'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/weigh-ins', ({ caller, query }) => WeighInService.list(caller, undefined, query.weeks), {
    query: ReviewQuery,
    response: Bodyweight,
    detail: { summary: 'Your weigh-ins over a period, newest first, and the latest before it' },
  })
  .post('/weigh-ins', ({ caller, body }) => WeighInService.create(caller, undefined, body), {
    body: WeighInInput,
    response: WeighIn,
  })
  .delete(
    '/weigh-ins/:weighInId',
    async ({ caller, params }) => {
      await WeighInService.remove(caller, undefined, params.weighInId)
      return { ok: true }
    },
    { params: one },
  )
  .get(
    '/athletes/:id/weigh-ins',
    ({ caller, params, query }) => WeighInService.list(caller, params.id, query.weeks),
    {
      params: theirs,
      query: ReviewQuery,
      response: Bodyweight,
      detail: { summary: "An athlete's weigh-ins over a period, newest first" },
    },
  )
  .post(
    '/athletes/:id/weigh-ins',
    ({ caller, params, body }) => WeighInService.create(caller, params.id, body),
    { params: theirs, body: WeighInInput, response: WeighIn },
  )
  .delete(
    '/athletes/:id/weigh-ins/:weighInId',
    async ({ caller, params }) => {
      await WeighInService.remove(caller, params.id, params.weighInId)
      return { ok: true }
    },
    { params: theirOne },
  )
