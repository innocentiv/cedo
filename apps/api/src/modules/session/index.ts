import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  ExerciseHistory,
  ExerciseHistoryQuery,
  Id,
  LogSetInput,
  SessionQuery,
  SessionStart,
  SessionUpdate,
  SetLog,
  WorkoutSession,
  WorkoutSessionSummary,
  page,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as HistoryService from './history.ts'
import { list as listSessions } from './list.ts'
import * as SessionService from './service.ts'

const params = z.object({ id: Id })

export const sessionRoutes = new Elysia({ prefix: '/sessions', tags: ['sessions'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller, query }) => listSessions(caller, query), {
    query: SessionQuery,
    response: page(WorkoutSessionSummary),
    detail: { summary: 'Session history, newest first. Summaries only — no per-set detail.' },
  })
  .post('/', ({ caller, body }) => SessionService.start(caller, body), {
    body: SessionStart,
    response: WorkoutSession,
    detail: { summary: 'Start a session, from a workout day or ad hoc' },
  })
  .get('/:id', ({ caller, params: { id } }) => SessionService.get(caller, id), {
    params,
    response: WorkoutSession,
  })
  .patch('/:id', ({ caller, params: { id }, body }) => SessionService.update(caller, id, body), {
    params,
    body: SessionUpdate,
    response: WorkoutSession,
    detail: { summary: 'Finish a session or amend its notes' },
  })
  .post(
    '/:id/logs',
    ({ caller, params: { id }, body }) => SessionService.logSet(caller, id, body),
    {
      params,
      body: LogSetInput,
      response: SetLog,
      detail: { summary: 'Record one performed set' },
    },
  )
  .delete(
    '/:id/logs/:logId',
    async ({ caller, params: { id, logId } }) => {
      await SessionService.removeLog(caller, id, logId)
      return { ok: true }
    },
    { params: z.object({ id: Id, logId: Id }) },
  )

/**
 * Mounted under /exercises rather than /sessions because it answers a question about an exercise.
 * Kept in the session module because it reads logs, which is this module's data.
 */
export const exerciseHistoryRoutes = new Elysia({ prefix: '/exercises', tags: ['sessions'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/:id/history',
    ({ caller, params: { id }, query }) => HistoryService.history(caller, id, query),
    {
      params,
      query: ExerciseHistoryQuery,
      response: ExerciseHistory,
      detail: {
        summary: "The caller's own logged sessions for one exercise, newest first",
      },
    },
  )
