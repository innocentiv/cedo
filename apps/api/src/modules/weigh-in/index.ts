import { Elysia } from 'elysia'
import { z } from 'zod'
import { Bodyweight, Id, ReviewQuery, WeighIn, WeighInInput } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { own, ownOrCoached } from '../coaching/training.ts'
import * as WeighInService from './service.ts'

const one = z.object({ weighInId: Id })
const theirs = z.object({ id: Id })
const theirOne = z.object({ id: Id, weighInId: Id })

/**
 * Weigh-ins (#42): yours at `/weigh-ins`, and an athlete's you coach at `/athletes/:id/weigh-ins` —
 * whose they are resolved here (`own`, `ownOrCoached`), once. Over the review's weeks, so a period
 * reads alike everywhere. Someone who does not share their training with you is a 404 on every
 * route.
 */
export const weighInRoutes = new Elysia({ tags: ['weigh-ins'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/weigh-ins',
    {
      query: ReviewQuery,
      response: Bodyweight,
      detail: { summary: 'Your weigh-ins over a period, newest first, and the latest before it' },
    },
    ({ caller, query }) => WeighInService.bodyweightOf(own(caller), query.weeks),
  )
  .post(
    '/weigh-ins',
    {
      body: WeighInInput,
      response: WeighIn,
    },
    ({ caller, body }) => WeighInService.create(own(caller), body),
  )
  .delete('/weigh-ins/:weighInId', { params: one }, async ({ caller, params }) => {
    await WeighInService.remove(own(caller), params.weighInId)
    return { ok: true }
  })
  .get(
    '/athletes/:id/weigh-ins',
    {
      params: theirs,
      query: ReviewQuery,
      response: Bodyweight,
      detail: { summary: "An athlete's weigh-ins over a period, newest first" },
    },
    async ({ caller, params, query }) =>
      await WeighInService.bodyweightOf(await ownOrCoached(caller, params.id), query.weeks),
  )
  .post(
    '/athletes/:id/weigh-ins',
    { params: theirs, body: WeighInInput, response: WeighIn },
    async ({ caller, params, body }) =>
      await WeighInService.create(await ownOrCoached(caller, params.id), body),
  )
  .delete(
    '/athletes/:id/weigh-ins/:weighInId',
    { params: theirOne },
    async ({ caller, params }) => {
      await WeighInService.remove(await ownOrCoached(caller, params.id), params.weighInId)
      return { ok: true }
    },
  )
