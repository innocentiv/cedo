import { and, asc, desc, eq, gte } from 'drizzle-orm'
import { type NextDay, type Today, type TodayQuery, nextDayOf } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { workoutSessions } from '../../db/schema.ts'
import { visibleExercises, visibleWorkoutDays, visibleWorkouts } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { planEntries } from '../workout/plan.ts'
import { list } from './list.ts'
import { type Training, own, sessionsOf } from './service.ts'

/**
 * `GET /today` (#25): the session in progress, the next day of the current workout, and this week —
 * what the first screen shows, decided here rather than joined there. See GLOSSARY.md, "Current
 * workout" and "Next day".
 */
export async function today(caller: Caller, query: TodayQuery): Promise<Today> {
  const training = own(caller)
  const [inProgress, next, week] = await Promise.all([
    list(training, { inProgress: true, limit: 1 }),
    nextDay(training),
    db
      .select({ startedAt: workoutSessions.startedAt })
      .from(workoutSessions)
      .where(and(sessionsOf(training), gte(workoutSessions.startedAt, new Date(query.weekStart))))
      .orderBy(asc(workoutSessions.startedAt)),
  ])
  return {
    inProgress: inProgress.items[0] ?? null,
    next,
    week: week.map((s) => s.startedAt.toISOString()),
  }
}

/**
 * The current workout — the one the latest session followed a day of, of those the reader can still
 * see: a plan out of reach cannot be started — and its next day, with that day's exercises by name.
 */
async function nextDay(training: Training): Promise<NextDay | null> {
  const workouts = visibleWorkouts(training.reader)
  const [current] = await db
    .select({ id: workouts.id, name: workouts.name })
    .from(workoutSessions)
    .innerJoin(workouts, eq(workouts.id, workoutSessions.workoutId))
    .where(sessionsOf(training))
    .orderBy(desc(workoutSessions.startedAt), desc(workoutSessions.id))
    .limit(1)
  if (current === undefined) return null

  const days = visibleWorkoutDays(training.reader)
  const day = nextDayOf(
    await db
      .select({ id: days.id, name: days.name })
      .from(days)
      .where(eq(days.workoutId, current.id))
      .orderBy(asc(days.index)),
    await lastDayTrained(training, current.id),
  )
  // A saved plan has a day at least (`WorkoutPlanInput`), and a workout is current only once one
  // of its days was trained: never undefined while the plan stays valid.
  if (day === undefined) return null
  return {
    workoutId: current.id,
    workoutName: current.name,
    dayId: day.id,
    dayName: day.name,
    exercises: await exercisesOf(training, current.id, day.id),
  }
}

/**
 * The latest day of `workoutId` trained that is still in it. A day removed from the plan leaves its
 * sessions behind with no day, so they are passed over: the plan goes on from the day before it.
 */
async function lastDayTrained(training: Training, workoutId: string): Promise<string | null> {
  const days = visibleWorkoutDays(training.reader)
  const [last] = await db
    .select({ id: days.id })
    .from(workoutSessions)
    .innerJoin(days, eq(days.id, workoutSessions.dayId))
    .where(and(sessionsOf(training), eq(workoutSessions.workoutId, workoutId)))
    .orderBy(desc(workoutSessions.startedAt), desc(workoutSessions.id))
    .limit(1)
  return last?.id ?? null
}

/** A day's exercises in plan order, by name — those the reader can still see. */
async function exercisesOf(training: Training, workoutId: string, dayId: string) {
  const entries = planEntries(training.reader, workoutId)
  const exercises = visibleExercises(training.reader)
  const names = await db
    .select({ name: exercises.name })
    .from(entries)
    .innerJoin(exercises, eq(exercises.id, entries.exerciseId))
    .where(eq(entries.dayId, dayId))
    .orderBy(asc(entries.index))
  return names.map((n) => n.name)
}
