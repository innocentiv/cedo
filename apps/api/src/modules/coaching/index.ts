import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  Athlete,
  AthleteEquipment,
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
import * as CoachingService from './service.ts'

const params = z.object({ id: Id })

/**
 * What a coach reads of the athletes who share their training with them (#11). GET only: a coach
 * changes nothing of an athlete's. Anyone not sharing with the caller is a 404 on every route.
 * See docs/adr/0021-coaching-through-groups.md.
 */
export const coachingRoutes = new Elysia({ prefix: '/athletes', tags: ['coaching'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller }) => CoachingService.athletes(caller), {
    response: z.array(Athlete),
    detail: { summary: 'Members sharing their training with a group the caller edits' },
  })
  .get(
    '/:id/sessions',
    ({ caller, params: { id }, query }) => CoachingService.sessions(caller, id, query),
    {
      params,
      query: SessionQuery,
      response: page(WorkoutSessionSummary),
      detail: { summary: "An athlete's sessions, newest first — the one in progress too" },
    },
  )
  .get(
    '/:id/sessions/:sessionId',
    ({ caller, params: { id, sessionId } }) => CoachingService.session(caller, id, sessionId),
    {
      params: z.object({ id: Id, sessionId: Id }),
      response: SessionDetail,
      detail: { summary: "One of an athlete's sessions, named as the caller can see it" },
    },
  )
  .get(
    '/:id/exercises/:exerciseId/history',
    ({ caller, params: { id, exerciseId }, query }) =>
      CoachingService.history(caller, id, exerciseId, query),
    {
      params: z.object({ id: Id, exerciseId: Id }),
      query: ExerciseHistoryQuery,
      response: ExerciseHistory,
      detail: { summary: "An athlete's logged sessions for one exercise the caller can see" },
    },
  )
  .get('/:id/equipment', ({ caller, params: { id } }) => CoachingService.equipment(caller, id), {
    params,
    response: AthleteEquipment,
    detail: { summary: 'What an athlete has to train with, and how its weights go (#34)' },
  })
  .get(
    '/:id/review',
    ({ caller, params: { id }, query }) => CoachingService.review(caller, id, query.weeks),
    {
      params,
      query: ReviewQuery,
      response: TrainingReview,
      detail: { summary: "An athlete's training, reviewed as their own Progress reviews it (#30)" },
    },
  )

/**
 * Your own training, reviewed (#28): the Progress tab's one read — the same review `training_review`
 * gives an AI, as `TrainingReview` says it. An athlete's, read by their coach, is
 * `/athletes/:id/review` (#30).
 */
export const reviewRoutes = new Elysia({ prefix: '/review', tags: ['coaching'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller, query }) => CoachingService.review(caller, undefined, query.weeks), {
    query: ReviewQuery,
    response: TrainingReview,
    detail: {
      summary:
        'Sessions a week and the streak, the days trained, work per muscle against the period before, and what has stalled, is falling or is drifting',
    },
  })
