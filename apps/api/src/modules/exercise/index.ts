import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  DuplicateInput,
  Exercise,
  ExerciseCreateRequest,
  ExerciseQuery,
  ExerciseUpdate,
  Id,
  TransferInput,
  page,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as ExerciseService from './service.ts'

const params = z.object({ id: Id })

export const exerciseRoutes = new Elysia({ prefix: '/exercises', tags: ['exercises'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller, query }) => ExerciseService.list(caller, query), {
    query: ExerciseQuery,
    response: page(Exercise),
    detail: { summary: 'List exercises visible to the caller' },
  })
  .post('/', ({ caller, body }) => ExerciseService.create(caller, body), {
    body: ExerciseCreateRequest,
    response: Exercise,
    detail: {
      summary: "Create an exercise in the caller's personal group, or the shared library",
      description: '`shared: true` puts it in the shared cedo library, which curators alone may.',
    },
  })
  .get('/:id', ({ caller, params: { id } }) => ExerciseService.get(caller, id), {
    params,
    response: Exercise,
  })
  .patch('/:id', ({ caller, params: { id }, body }) => ExerciseService.update(caller, id, body), {
    params,
    body: ExerciseUpdate,
    response: Exercise,
  })
  .delete(
    '/:id',
    async ({ caller, params: { id } }) => {
      await ExerciseService.remove(caller, id)
      return { ok: true }
    },
    { params },
  )
  .post(
    '/:id/duplicate',
    ({ caller, params: { id }, body }) => ExerciseService.duplicate(caller, id, body.toGroupId),
    {
      params,
      body: DuplicateInput,
      response: Exercise,
      detail: { summary: 'Copy into a group you can edit, so you can change the copy' },
    },
  )
  .post(
    '/:id/transfer',
    ({ caller, params: { id }, body }) => ExerciseService.transfer(caller, id, body.toGroupId),
    { params, body: TransferInput, response: Exercise },
  )
  .put(
    '/:id/favourite',
    async ({ caller, params: { id } }) => {
      await ExerciseService.setFavourite(caller, id, true)
      return { ok: true }
    },
    { params },
  )
  .delete(
    '/:id/favourite',
    async ({ caller, params: { id } }) => {
      await ExerciseService.setFavourite(caller, id, false)
      return { ok: true }
    },
    { params },
  )
