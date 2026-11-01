import {
  type SessionDetail,
  type SessionPlan,
  type WorkoutSession,
  workingSetsDone,
} from '@cedo/contract'
import { hydrateDay } from '../workout/plan.ts'
import type { Training } from '../coaching/training.ts'
import { read } from './service.ts'

/**
 * The plan a session follows, as its reader can reach it — read with the session on its own
 * (`GET /sessions/:id`). See `SessionPlan`.
 */

/** A session with the plan it follows. */
export async function get(training: Training, id: string): Promise<SessionDetail> {
  const session = await read(training, id)
  return { ...session, plan: await planOf(training, session) }
}

/**
 * None, out of reach, or the day — each entry with the working sets done in its series.
 *
 * Decided from the same visible relations the session's logs are read and numbered by: `logs`
 * carry `entryId: null` exactly when their entry is out of reach, so an entry's done count and the
 * next set's number cannot disagree. The session screen used to decide this by joining three reads
 * of its own, and took a plan it failed to FETCH for one out of reach — logging the next set into
 * the wrong series.
 */
async function planOf(training: Training, session: WorkoutSession): Promise<SessionPlan> {
  if (session.workoutId === null || session.dayId === null) return null
  // Named as the reader can see it; doable for the athlete who trains it (#35).
  const day = await hydrateDay(
    training.reader,
    session.workoutId,
    session.dayId,
    training.athleteId,
  )
  if (day === null) return { reachable: false }
  // Rows hydrated for this read alone: annotated in place, not copied.
  const entries = day.entries.map((entry) =>
    Object.assign(entry, {
      done: workingSetsDone(session.logs, { entryId: entry.id, exerciseId: entry.exerciseId }),
    }),
  )
  return { reachable: true, day: { ...day, entries } }
}
