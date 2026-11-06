import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  ExerciseHistory,
  ExerciseHistoryQuery,
  Id,
  IDEMPOTENCY_KEY_HEADER,
  LogSetHeaders,
  LogSetInput,
  RestChange,
  SessionEntryTarget,
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
import { own } from '../coaching/training.ts'
import { targetsForSession } from '../progression/targets.ts'
import { start as startSession } from './start.ts'
import { history } from './history.ts'
import { list as listSessions } from './list.ts'
import { get as getSession } from './plan.ts'
import { today } from './today.ts'
import * as SessionService from './service.ts'
import { amendLog, logSet, removeLog } from './set-writes.ts'
import { remove as removeSession, update as updateSession } from './write-session.ts'

const params = z.object({ id: Id })
const logParams = z.object({ id: Id, logId: Id })

export const sessionRoutes = new Elysia({ prefix: '/sessions', tags: ['sessions'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller, query }) => listSessions(own(caller), query), {
    query: SessionQuery,
    response: page(WorkoutSessionSummary),
    detail: { summary: 'Session history, newest first. Summaries only — no per-set detail.' },
  })
  .post('/', ({ caller, body }) => startSession(caller, body), {
    body: SessionStart,
    response: WorkoutSession,
    detail: { summary: 'Start a session, from a workout day or ad hoc' },
  })
  .get('/:id', ({ caller, params: { id } }) => getSession(own(caller), id), {
    params,
    response: SessionDetail,
    detail: { summary: 'A session, with the plan it follows as the caller can reach it' },
  })
  .get('/:id/targets', ({ caller, params: { id } }) => targetsForSession(caller, id), {
    params,
    response: z.array(SessionEntryTarget),
    detail: {
      summary:
        "What the session asks of each entry of its day — the caller's target, as the steps of the sessions before this one left it (ADR-0026) — and last time's sets",
    },
  })
  .patch('/:id', ({ caller, params: { id }, body }) => updateSession(caller, id, body), {
    params,
    body: SessionUpdate,
    response: WorkoutSession,
    detail: { summary: 'Finish a session or amend its notes' },
  })
  .delete(
    '/:id',
    async ({ caller, params: { id } }) => {
      await removeSession(caller, id)
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
      await SessionService.changeRest(caller, id, body)
      return { ok: true }
    },
    { params, body: RestChange, detail: { summary: 'Add 30 s to the rest running, or skip it' } },
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
  .get('/:id/history', ({ caller, params: { id }, query }) => history(own(caller), id, query), {
    params,
    query: ExerciseHistoryQuery,
    response: ExerciseHistory,
    detail: {
      summary: "The caller's own logged sessions for one exercise, newest first",
    },
  })
