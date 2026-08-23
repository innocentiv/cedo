import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  DuplicateInput,
  Id,
  ProgressionSuggestion,
  TransferInput,
  Workout,
  WorkoutCreate,
  WorkoutPlanInput,
  WorkoutQuery,
  WorkoutSummary,
  WorkoutUpdate,
  page,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as ProgressionService from '../progression/service.ts'
import * as WorkoutService from './service.ts'

const params = z.object({ id: Id })

export const workoutRoutes = new Elysia({ prefix: '/workouts', tags: ['workouts'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller, query }) => WorkoutService.list(caller, query), {
    query: WorkoutQuery,
    response: page(WorkoutSummary),
    detail: {
      summary: 'List workouts. Summaries only — a page of full plans is a useless payload.',
    },
  })
  .post('/', ({ caller, body }) => WorkoutService.create(caller, body), {
    body: WorkoutCreate,
    response: Workout,
  })
  .get('/:id', ({ caller, params: { id } }) => WorkoutService.get(caller, id), {
    params,
    response: Workout,
    detail: { summary: 'One workout with its full nested plan' },
  })
  .patch('/:id', ({ caller, params: { id }, body }) => WorkoutService.update(caller, id, body), {
    params,
    body: WorkoutUpdate,
    response: Workout,
  })
  .delete(
    '/:id',
    async ({ caller, params: { id } }) => {
      await WorkoutService.remove(caller, id)
      return { ok: true }
    },
    { params },
  )
  .put(
    '/:id/plan',
    ({ caller, params: { id }, body }) => WorkoutService.replacePlan(caller, id, body),
    {
      params,
      body: WorkoutPlanInput,
      response: Workout,
      detail: {
        summary: 'Replace the entire plan atomically. Order is array position; send no indices.',
      },
    },
  )
  .get(
    '/:id/progression',
    ({ caller, params: { id } }) => ProgressionService.suggestForWorkout(caller, id),
    {
      params,
      response: z.array(ProgressionSuggestion),
      detail: {
        summary: "What each entry's next target should be, from its logged history",
      },
    },
  )
  .post(
    '/:id/duplicate',
    ({ caller, params: { id }, body }) => WorkoutService.duplicate(caller, id, body.toGroupId),
    { params, body: DuplicateInput, response: Workout },
  )
  .post(
    '/:id/transfer',
    ({ caller, params: { id }, body }) => WorkoutService.transfer(caller, id, body.toGroupId),
    { params, body: TransferInput, response: Workout },
  )
  .put(
    '/:id/favourite',
    async ({ caller, params: { id } }) => {
      await WorkoutService.setFavourite(caller, id, true)
      return { ok: true }
    },
    { params },
  )
  .delete(
    '/:id/favourite',
    async ({ caller, params: { id } }) => {
      await WorkoutService.setFavourite(caller, id, false)
      return { ok: true }
    },
    { params },
  )
