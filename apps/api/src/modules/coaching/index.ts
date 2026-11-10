import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  Athlete,
  ExerciseHistory,
  ExerciseHistoryQuery,
  Id,
  ReviewQuery,
  SessionDetail,
  SessionQuery,
  TrainingReview,
  WorkoutSessionSummary,
  page,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { trainingReview } from '../review/service.ts'
import { history } from '../session/history.ts'
import { list as listSessions } from '../session/list.ts'
import { get as getSession } from '../session/plan.ts'
import { athletes } from './athletes.ts'
import { own, ownOrCoached } from './training.ts'

const params = z.object({ id: Id })

/**
 * What a coach reads of the athletes who share their training with them (#11) — each the athlete's
 * own read, for the `Training` resolved here (`ownOrCoached`), so it computes as theirs does. GET
 * only: a coach changes nothing of an athlete's training — their notes and weigh-ins, which a coach
 * writes too, are `modules/note` and `modules/weigh-in`; their equipment, `modules/equipment`.
 * Anyone not sharing with the caller is a 404 on every route. See
 * docs/adr/0021-coaching-through-groups.md.
 */
export const coachingRoutes = new Elysia({ prefix: '/athletes', tags: ['coaching'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/',
    {
      response: z.array(Athlete),
      detail: { summary: 'Members sharing their training with a group the caller edits' },
    },
    ({ caller }) => athletes(caller),
  )
  .get(
    '/:id/sessions',
    {
      params,
      query: SessionQuery,
      response: page(WorkoutSessionSummary),
      detail: { summary: "An athlete's sessions, newest first — the one in progress too" },
    },
    async ({ caller, params: { id }, query }) =>
      await listSessions(await ownOrCoached(caller, id), query),
  )
  .get(
    '/:id/sessions/:sessionId',
    {
      params: z.object({ id: Id, sessionId: Id }),
      response: SessionDetail,
      detail: { summary: "One of an athlete's sessions, named as the caller can see it" },
    },
    async ({ caller, params: { id, sessionId } }) =>
      await getSession(await ownOrCoached(caller, id), sessionId),
  )
  .get(
    '/:id/exercises/:exerciseId/history',
    {
      params: z.object({ id: Id, exerciseId: Id }),
      query: ExerciseHistoryQuery,
      response: ExerciseHistory,
      detail: { summary: "An athlete's logged sessions for one exercise the caller can see" },
    },
    async ({ caller, params: { id, exerciseId }, query }) =>
      await history(await ownOrCoached(caller, id), exerciseId, query),
  )
  .get(
    '/:id/review',
    {
      params,
      query: ReviewQuery,
      response: TrainingReview,
      detail: { summary: "An athlete's training, reviewed as their own Progress reviews it (#30)" },
    },
    async ({ caller, params: { id }, query }) =>
      await trainingReview(await ownOrCoached(caller, id), query.weeks),
  )

/**
 * Your own training, reviewed (#28): the Progress tab's one read — the same review `training_review`
 * gives an AI, as `TrainingReview` says it. An athlete's, read by their coach, is
 * `/athletes/:id/review` (#30).
 */
export const reviewRoutes = new Elysia({ prefix: '/review', tags: ['coaching'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/',
    {
      query: ReviewQuery,
      response: TrainingReview,
      detail: {
        summary:
          'Sessions a week and the streak, the days trained, work per muscle against the period before, and what has stalled, is falling or is drifting',
      },
    },
    ({ caller, query }) => trainingReview(own(caller), query.weeks),
  )
