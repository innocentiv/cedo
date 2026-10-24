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
import { ownOrCoached } from './athletes.ts'

export { athletes } from './athletes.ts'

/**
 * A person's training, read: the caller's own, or — given `athleteId` — an athlete's they coach.
 * The HTTP routes, `/sessions` and `/athletes/:id/…` alike, and the MCP tools all call these, so a
 * coach's answer and the athlete's cannot compute differently — only name differently, by what each
 * can see. Every one reads; none writes.
 */

export const sessions = async (
  caller: Caller,
  athleteId: string | undefined,
  query: SessionQuery,
): Promise<Page<WorkoutSessionSummary>> =>
  await listSessions(await ownOrCoached(caller, athleteId), query)

export const session = async (
  caller: Caller,
  athleteId: string | undefined,
  sessionId: string,
): Promise<SessionDetail> => await getSession(await ownOrCoached(caller, athleteId), sessionId)

export const history = async (
  caller: Caller,
  athleteId: string | undefined,
  exerciseId: string,
  query: ExerciseHistoryQuery,
): Promise<ExerciseHistory> =>
  await exerciseHistory(await ownOrCoached(caller, athleteId), exerciseId, query)

export const review = async (
  caller: Caller,
  athleteId: string | undefined,
  weeks: number,
): Promise<TrainingReview> => await trainingReview(await ownOrCoached(caller, athleteId), weeks)
