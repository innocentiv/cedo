import type {
  AthleteEquipment,
  Exercise,
  ExerciseQuery,
  PlanSave,
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
import { get as getWorkout, replacePlan } from '../workout/service.ts'
import { ownOrCoached } from './training.ts'

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
export const equipment = async (caller: Caller, athleteId?: string): Promise<AthleteEquipment> =>
  await readEquipment(await ownOrCoached(caller, athleteId))

/**
 * The library, judged by what an athlete has (#35): a coach planning for their gym searches what
 * THEY can do. Named as the coach can see it — the library is the coach's to read.
 */
export const exercises = async (
  caller: Caller,
  athleteId: string | undefined,
  query: ExerciseQuery,
): Promise<Page<Exercise>> => await listExercises(await ownOrCoached(caller, athleteId), query)

/**
 * A workout read for an athlete — the caller, or one a coach writes it for — with what they have:
 * its exercises marked doable or not (#35), and its weights readable as they can load them (#36).
 */
export const planFor = async (
  caller: Caller,
  athleteId: string | undefined,
  workoutId: string,
): Promise<PlanRead> => {
  const training = await ownOrCoached(caller, athleteId)
  const [workout, held] = await Promise.all([
    getWorkout(training, workoutId),
    readEquipment(training),
  ])
  return { workout, held }
}

/** A plan saved whole, read back as `planFor` reads the caller's own. */
export const savePlan = async (
  caller: Caller,
  workoutId: string,
  plan: PlanSave,
): Promise<PlanRead> => {
  const workout = await replacePlan(caller, workoutId, plan)
  return { workout, held: await equipment(caller) }
}

/** A plan, and what the athlete it is read for has to train with. */
interface PlanRead {
  readonly workout: Workout
  readonly held: AthleteEquipment
}
