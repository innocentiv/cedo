import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  DuplicateInput,
  Exercise,
  ExerciseCreateRequest,
  ExerciseQuery,
  ExerciseUpdate,
  Id,
  RecentExercisesQuery,
  TransferInput,
  page,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { own } from '../coaching/training.ts'
import * as ExerciseService from './service.ts'

const params = z.object({ id: Id })

export const exerciseRoutes = new Elysia({ prefix: '/exercises', tags: ['exercises'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/',
    {
      query: ExerciseQuery,
      response: page(Exercise),
      detail: { summary: 'List exercises visible to the caller' },
    },
    ({ caller, query }) => ExerciseService.list(own(caller), query),
  )
  .post(
    '/',
    {
      body: ExerciseCreateRequest,
      response: Exercise,
      detail: {
        summary: "Create an exercise in the caller's personal group, or the shared library",
        description: '`shared: true` puts it in the shared cedo library, which curators alone may.',
      },
    },
    ({ caller, body }) => ExerciseService.create(caller, body),
  )
  .get(
    '/recent',
    {
      query: RecentExercisesQuery,
      response: z.array(Exercise),
      detail: {
        summary:
          'The exercises the caller logged most lately, latest first — those they can still see',
      },
    },
    ({ caller, query }) => ExerciseService.recent(caller, query),
  )
  .get(
    '/:id',
    {
      params,
      response: Exercise,
    },
    ({ caller, params: { id } }) => ExerciseService.get(caller, id),
  )
  .patch(
    '/:id',
    {
      params,
      body: ExerciseUpdate,
      response: Exercise,
    },
    ({ caller, params: { id }, body }) => ExerciseService.update(caller, id, body),
  )
  .delete('/:id', { params }, async ({ caller, params: { id } }) => {
    await ExerciseService.remove(caller, id)
    return { ok: true }
  })
  .post(
    '/:id/duplicate',
    {
      params,
      body: DuplicateInput,
      response: Exercise,
      detail: { summary: 'Copy into a group you can edit, so you can change the copy' },
    },
    ({ caller, params: { id }, body }) => ExerciseService.duplicate(caller, id, body.toGroupId),
  )
  .post(
    '/:id/transfer',
    { params, body: TransferInput, response: Exercise },
    ({ caller, params: { id }, body }) => ExerciseService.transfer(caller, id, body.toGroupId),
  )
  .put('/:id/favourite', { params }, async ({ caller, params: { id } }) => {
    await ExerciseService.setFavourite(caller, id, true)
    return { ok: true }
  })
  .delete('/:id/favourite', { params }, async ({ caller, params: { id } }) => {
    await ExerciseService.setFavourite(caller, id, false)
    return { ok: true }
  })
