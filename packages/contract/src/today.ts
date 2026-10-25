import { z } from 'zod'
import { WorkoutSessionSummary } from './log.ts'
import { Id, Timestamp } from './primitives.ts'

/**
 * `GET /today` (#25): what to do next, answered by the server rather than joined by a screen. See
 * docs/08-frontend.md, "Today", and GLOSSARY.md, "Current workout" and "Next day".
 */

/** Where the reader's week starts, in their own time (`startOfWeek`): the server cannot know it. */
export const TodayQuery = z.object({ weekStart: Timestamp })
export type TodayQuery = z.output<typeof TodayQuery>

/** The next day of the current workout: enough to say what it is and start it. */
export const NextDay = z.object({
  workoutId: Id,
  workoutName: z.string(),
  dayId: Id,
  dayName: z.string(),
  /** The day's exercises in plan order, by name — those the reader can still see. */
  exercises: z.array(z.string()),
})
export type NextDay = z.output<typeof NextDay>

export const Today = z.object({
  /** The session in progress — at most one. */
  inProgress: WorkoutSessionSummary.nullable(),
  /** Null with no current workout: nothing trained from a plan the reader can still see. */
  next: NextDay.nullable(),
  /** When each session of this week started, oldest first: the week's strip and its count. */
  week: z.array(Timestamp),
})
export type Today = z.output<typeof Today>

/**
 * The next day (GLOSSARY.md): the one after the day trained last, in plan order, back to the first
 * after the last. A day trained last that is gone from the plan has no place to count from: the
 * plan starts again at its first day.
 */
export function nextDayOf<D extends { readonly id: string }>(
  days: readonly D[],
  lastDayId: string | null,
): D | undefined {
  const last = days.findIndex((d) => d.id === lastDayId)
  return last === -1 ? days[0] : days[(last + 1) % days.length]
}
