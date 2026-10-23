import type {
  ExerciseHistory,
  ExerciseHistoryQuery,
  Page,
  SessionDetail,
  SessionQuery,
  WorkoutSessionSummary,
} from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import { type TrainingReview, trainingReview } from '../review/service.ts'
import { history as exerciseHistory } from '../session/history.ts'
import { list as listSessions } from '../session/list.ts'
import { get as getSession } from '../session/plan.ts'
import { trainingOf } from './athletes.ts'

export { athletes } from './athletes.ts'

/**
 * What a coach reads of an athlete: their own reads of their own training, each given the athlete's
 * `Training` — so a coach's answer and the athlete's cannot compute differently, only name
 * differently, by what each can see. Every one reads; none writes.
 */

export const sessions = async (
  caller: Caller,
  athleteId: string,
  query: SessionQuery,
): Promise<Page<WorkoutSessionSummary>> =>
  await listSessions(await trainingOf(caller, athleteId), query)

export const session = async (
  caller: Caller,
  athleteId: string,
  sessionId: string,
): Promise<SessionDetail> => await getSession(await trainingOf(caller, athleteId), sessionId)

export const history = async (
  caller: Caller,
  athleteId: string,
  exerciseId: string,
  query: ExerciseHistoryQuery,
): Promise<ExerciseHistory> =>
  await exerciseHistory(await trainingOf(caller, athleteId), exerciseId, query)

export const review = async (
  caller: Caller,
  athleteId: string,
  weeks: number,
): Promise<TrainingReview> => await trainingReview(await trainingOf(caller, athleteId), weeks)
