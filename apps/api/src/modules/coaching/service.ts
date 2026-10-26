import type {
  AthleteEquipment,
  Exercise,
  ExerciseQuery,
  ExerciseHistory,
  ExerciseHistoryQuery,
  Page,
  SessionDetail,
  SessionQuery,
  TrainingReview,
  Workout,
  WorkoutSessionSummary,
} from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import { read as readEquipment } from '../equipment/service.ts'
import { list as listExercises } from '../exercise/service.ts'
import { trainingReview } from '../review/service.ts'
import { history as exerciseHistory } from '../session/history.ts'
import { list as listSessions } from '../session/list.ts'
import { get as getSession } from '../session/plan.ts'
import { get as getWorkout } from '../workout/service.ts'
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

/** What they have to train with (#34) — a coach plans for an athlete's gym, and changes none of it. */
export const equipment = async (
  caller: Caller,
  athleteId: string | undefined,
): Promise<AthleteEquipment> => await readEquipment(await ownOrCoached(caller, athleteId))

/**
 * The library, judged by what an athlete has (#35): a coach planning for their gym searches what
 * THEY can do. Named as the coach can see it — the library is the coach's to read.
 */
export const exercises = async (
  caller: Caller,
  athleteId: string | undefined,
  query: ExerciseQuery,
): Promise<Page<Exercise>> =>
  await listExercises(caller, query, (await ownOrCoached(caller, athleteId)).athleteId)

/** A workout, its exercises marked by what an athlete has (#35) — the plan a coach writes for them. */
export const workout = async (
  caller: Caller,
  athleteId: string | undefined,
  workoutId: string,
): Promise<Workout> =>
  await getWorkout(caller, workoutId, (await ownOrCoached(caller, athleteId)).athleteId)
