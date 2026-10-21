import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  EntryTarget,
  ExerciseHistory,
  ExerciseHistoryQuery,
  Id,
  LogSetInput,
  SessionQuery,
  SessionStart,
  SessionUpdate,
  SetLog,
  SessionDetail,
  WorkoutSession,
  WorkoutSessionSummary,
  page,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { targetsForSession } from '../progression/service.ts'
import { get as getSession } from './plan.ts'
import { start as startSession } from './start.ts'
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
  .post('/', ({ caller, body }) => startSession(caller, body), {
    body: SessionStart,
    response: WorkoutSession,
    detail: { summary: 'Start a session, from a workout day or ad hoc' },
  })
  .get('/:id', ({ caller, params: { id } }) => getSession(caller, id), {
    params,
    response: SessionDetail,
    detail: { summary: 'A session, with the plan it follows as the caller can reach it' },
  })
  .get('/:id/targets', ({ caller, params: { id } }) => targetsForSession(caller, id), {
    params,
    response: z.array(EntryTarget),
    detail: {
      summary:
        "What the session asks of each entry of its day — the plan carried forward by its rule over the sessions before this one — and last time's sets",
    },
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
