import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { type TrainingReview, weeksToMs } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { workoutSessions } from '../../db/schema.ts'
import { visibleWorkoutDays, visibleWorkouts } from '../../db/visible.ts'
import { type Training, sessionsOf } from '../coaching/training.ts'
import { aboutThem } from './about.ts'
import { adherenceOf } from './adherence.ts'
import { latestJudged, muscleWorkOver } from './sets.ts'

/**
 * A READ MODEL for coaching, not new domain rules.
 *
 * Everything here is aggregation over data the API already exposes. It exists because the
 * alternative — the AI paging through every session and every log and doing date arithmetic itself
 * — is slow, expensive in context, and a reliable source of quiet mistakes. One call returns what a
 * coach would actually look at. See docs/07-mcp.md.
 */

export async function trainingReview(training: Training, weeks: number): Promise<TrainingReview> {
  // The clock, read once for the periods compared and the streak, so all three are as of one
  // moment. What is said of the athlete reads it on its own (`about.ts`): the bodyweight's period
  // and the age.
  const now = Date.now()
  const since = new Date(now - weeksToMs(weeks))
  const previousSince = new Date(now - weeksToMs(weeks * 2))

  const sessions = await db
    .select({
      id: workoutSessions.id,
      startedAt: workoutSessions.startedAt,
      dayId: workoutSessions.dayId,
    })
    .from(workoutSessions)
    .where(and(sessionsOf(training), gte(workoutSessions.startedAt, since)))
    .orderBy(desc(workoutSessions.startedAt))

  return {
    weeks,
    adherence: adherenceOf(sessions, weeks, now),
    dayBalance: await dayBalance(training, since),
    muscleWork: await muscleWorkOver(training, { previousSince, since, until: new Date(now) }),
    ...(await latestJudged(training, since)),
    ...(await aboutThem(training, weeks)),
  }
}

/**
 * Every planned day of the workouts trained in the period, and how often each was — none, for a day
 * skipped every time (#28): a day never trained is the one most worth seeing, and counting from the
 * sessions alone left it out. In plan order, workout by workout.
 */
async function dayBalance(training: Training, since: Date): Promise<TrainingReview['dayBalance']> {
  const days = visibleWorkoutDays(training.reader)
  const workouts = visibleWorkouts(training.reader)
  const inPeriod = and(sessionsOf(training), gte(workoutSessions.startedAt, since))
  const trained = db
    .selectDistinct({ id: workoutSessions.workoutId })
    .from(workoutSessions)
    .where(inPeriod)
  const rows = await db
    .select({
      day: days.name,
      workout: workouts.name,
      sessions: sql<number>`count(${workoutSessions.id})`.mapWith(Number),
    })
    /**
     * INNER joins onto the visible relations, so a day whose workout is unreachable drops out
     * entirely — you cannot balance days you cannot see. A correlated subquery for the workout's
     * name (`select name from workouts where id = …`) is how this once named a workout the caller
     * had lost access to; there is no raw table left to write one against.
     */
    .from(days)
    .innerJoin(workouts, eq(workouts.id, days.workoutId))
    .leftJoin(workoutSessions, and(eq(workoutSessions.dayId, days.id), inPeriod))
    .where(inArray(days.workoutId, trained))
    /**
     * By ID, not by name. Two days can share a name across two plans, and two plans can share a
     * name outright — duplicating one is the documented way to get an editable copy. Grouping on
     * the text merges them into one row whose session count is the sum of both.
     */
    .groupBy(days.id, days.name, days.index, workouts.id, workouts.name)
    .orderBy(asc(workouts.name), asc(workouts.id), asc(days.index))

  return rows.map((r) => ({ day: r.day, workout: r.workout, sessions: r.sessions }))
}
