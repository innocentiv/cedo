import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  DuplicateInput,
  EntryTarget,
  Id,
  TargetByHand,
  TransferInput,
  Workout,
  WorkoutCreate,
  PlanSave,
  WorkoutQuery,
  WorkoutSummary,
  WorkoutUpdate,
  page,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { own } from '../coaching/training.ts'
import * as ProgressionService from '../progression/service.ts'
import * as WorkoutService from './service.ts'

const params = z.object({ id: Id })

export const workoutRoutes = new Elysia({ prefix: '/workouts', tags: ['workouts'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/',
    {
      query: WorkoutQuery,
      response: page(WorkoutSummary),
      detail: {
        summary: 'List workouts. Summaries only — a page of full plans is a useless payload.',
      },
    },
    ({ caller, query }) => WorkoutService.list(caller, query),
  )
  .post(
    '/',
    {
      body: WorkoutCreate,
      response: Workout,
    },
    ({ caller, body }) => WorkoutService.create(caller, body),
  )
  .get(
    '/:id',
    {
      params,
      response: Workout,
      detail: { summary: 'One workout with its full nested plan' },
    },
    ({ caller, params: { id } }) => WorkoutService.get(own(caller), id),
  )
  .patch(
    '/:id',
    {
      params,
      body: WorkoutUpdate,
      response: Workout,
    },
    ({ caller, params: { id }, body }) => WorkoutService.update(caller, id, body),
  )
  .delete('/:id', { params }, async ({ caller, params: { id } }) => {
    await WorkoutService.remove(caller, id)
    return { ok: true }
  })
  .put(
    '/:id/plan',
    {
      params,
      body: PlanSave,
      response: Workout,
      detail: {
        summary: 'Replace the entire plan atomically. Order is array position; send no indices.',
        description:
          'Send the `version` the plan was read at: a save made from an older one is refused with ' +
          '409, and the plan should be read again. Without one the save is unconditional.',
      },
    },
    ({ caller, params: { id }, body }) => WorkoutService.replacePlan(caller, id, body),
  )
  .get(
    '/:id/progression',
    {
      params,
      response: z.array(EntryTarget),
      detail: {
        summary: "Each entry's target, as the caller's steps left it (ADR-0026)",
      },
    },
    ({ caller, params: { id } }) => ProgressionService.targetsForWorkout(caller, id),
  )
  .put(
    '/:id/entries/:entryId/target',
    {
      params: z.object({ id: Id, entryId: Id }),
      body: TargetByHand,
      response: EntryTarget,
      detail: {
        summary:
          'Set your own target on an entry by hand: only what its rule moves. Writes your step, never the plan (ADR-0026)',
      },
    },
    ({ caller, params: { id, entryId }, body }) =>
      ProgressionService.setTargetByHand(caller, id, entryId, body),
  )
  .post(
    '/:id/duplicate',
    { params, body: DuplicateInput, response: Workout },
    ({ caller, params: { id }, body }) => WorkoutService.duplicate(caller, id, body.toGroupId),
  )
  .post(
    '/:id/transfer',
    { params, body: TransferInput, response: Workout },
    ({ caller, params: { id }, body }) => WorkoutService.transfer(caller, id, body.toGroupId),
  )
  .put('/:id/favourite', { params }, async ({ caller, params: { id } }) => {
    await WorkoutService.setFavourite(caller, id, true)
    return { ok: true }
  })
  .delete('/:id/favourite', { params }, async ({ caller, params: { id } }) => {
    await WorkoutService.setFavourite(caller, id, false)
    return { ok: true }
  })
