import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  EntryTarget,
  ExerciseHistory,
  ExerciseHistoryQuery,
  Id,
  IDEMPOTENCY_KEY_HEADER,
  LogSetHeaders,
  LogSetInput,
  SessionQuery,
  SessionStart,
  SessionUpdate,
  SetLog,
  SetLogUpdate,
  SessionDetail,
  Today,
  TodayQuery,
  WorkoutSession,
  WorkoutSessionSummary,
  page,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as CoachingService from '../coaching/service.ts'
import { targetsForSession } from '../progression/targets.ts'
import { start as startSession } from './start.ts'
import { logSet } from './log-set.ts'
import { today } from './today.ts'
import * as SessionService from './service.ts'

const params = z.object({ id: Id })

export const sessionRoutes = new Elysia({ prefix: '/sessions', tags: ['sessions'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller, query }) => CoachingService.sessions(caller, undefined, query), {
    query: SessionQuery,
    response: page(WorkoutSessionSummary),
    detail: { summary: 'Session history, newest first. Summaries only — no per-set detail.' },
  })
  .post('/', ({ caller, body }) => startSession(caller, body), {
    body: SessionStart,
    response: WorkoutSession,
    detail: { summary: 'Start a session, from a workout day or ad hoc' },
  })
  .get('/:id', ({ caller, params: { id } }) => CoachingService.session(caller, undefined, id), {
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
  .delete(
    '/:id',
    async ({ caller, params: { id } }) => {
      await SessionService.remove(caller, id)
      return { ok: true }
    },
    { params, detail: { summary: 'Delete a session and its sets, in progress or finished' } },
  )
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
    ({ caller, params: { id, logId }, body }) => SessionService.amendLog(caller, id, logId, body),
    {
      params: z.object({ id: Id, logId: Id }),
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
      await SessionService.removeLog(caller, id, logId)
      return { ok: true }
    },
    {
      params: z.object({ id: Id, logId: Id }),
      detail: { summary: 'Remove a set: an undo, or a past mistake fixed' },
    },
  )

/** What to do next (#25): the first screen's one read. */
export const todayRoutes = new Elysia({ prefix: '/today', tags: ['sessions'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller, query }) => today(caller, query), {
    query: TodayQuery,
    response: Today,
    detail: {
      summary:
        'The session in progress, the next day of the current workout, and when each session of this week started',
    },
  })

/**
 * Mounted under /exercises rather than /sessions because it answers a question about an exercise.
 * Kept in the session module because it reads logs, which is this module's data.
 */
export const exerciseHistoryRoutes = new Elysia({ prefix: '/exercises', tags: ['sessions'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/:id/history',
    ({ caller, params: { id }, query }) => CoachingService.history(caller, undefined, id, query),
    {
      params,
      query: ExerciseHistoryQuery,
      response: ExerciseHistory,
      detail: {
        summary: "The caller's own logged sessions for one exercise, newest first",
      },
    },
  )
