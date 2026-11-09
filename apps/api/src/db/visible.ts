import { QueryBuilder } from 'drizzle-orm/pg-core'
import { type AccessContext, visible } from './ownable.ts'
import { exerciseMedia, exerciseMuscles, exercises } from './tables/exercise.ts'
import { workoutDays, workoutEntries, workoutSets, workouts } from './tables/workout.ts'

/**
 * Visible relations: the rows of each owned table that a caller may read, as something a query
 * selects FROM or JOINs — the only way module code reads these tables.
 *
 * `visible()` used to be a predicate every query had to remember, in the right place, on every
 * join. It was missed five times. A relation cannot be forgotten in the same way: there is no raw
 * table left to join by mistake, because lint refuses the import outside `db/`, the write files
 * and tests. What remains for the reader is the one decision the domain actually asks of them —
 * see docs/03-domain-model.md:
 *
 *   - LEFT JOIN a relation when the row must survive and the joined name may become null;
 *   - INNER JOIN it, or select FROM it, when the row is about the thing and must drop out.
 *
 * Each is an aliased subquery, `(select * from t where owner_group_id in (…)) as t`, which Postgres
 * pulls up into the outer query: the plans are the ones the raw table gets, indexes included.
 * `bun run perf` holds that. The alias defaults to the table's own name; pass another when one
 * query needs the same relation twice. See docs/adr/0019-visible-relations.md.
 *
 * Writes do not go through here — a subquery cannot be an UPDATE target. They live in each
 * module's `write*.ts`, which may import the raw tables and must gate with `editable()`.
 */

const qb = new QueryBuilder()

const exercisesAs = <TAlias extends string>(caller: AccessContext, alias: TAlias) =>
  qb.select().from(exercises).where(visible(exercises, caller)).as(alias)
export function visibleExercises(caller: AccessContext): ReturnType<typeof exercisesAs<'exercises'>>
export function visibleExercises<TAlias extends string>(
  caller: AccessContext,
  alias: TAlias,
): ReturnType<typeof exercisesAs<TAlias>>
export function visibleExercises(caller: AccessContext, alias = 'exercises') {
  return exercisesAs(caller, alias)
}

const exerciseMusclesAs = <TAlias extends string>(caller: AccessContext, alias: TAlias) =>
  qb.select().from(exerciseMuscles).where(visible(exerciseMuscles, caller)).as(alias)
export function visibleExerciseMuscles(
  caller: AccessContext,
): ReturnType<typeof exerciseMusclesAs<'exercise_muscles'>>
export function visibleExerciseMuscles<TAlias extends string>(
  caller: AccessContext,
  alias: TAlias,
): ReturnType<typeof exerciseMusclesAs<TAlias>>
export function visibleExerciseMuscles(caller: AccessContext, alias = 'exercise_muscles') {
  return exerciseMusclesAs(caller, alias)
}

const exerciseMediaAs = <TAlias extends string>(caller: AccessContext, alias: TAlias) =>
  qb.select().from(exerciseMedia).where(visible(exerciseMedia, caller)).as(alias)
export function visibleExerciseMedia(
  caller: AccessContext,
): ReturnType<typeof exerciseMediaAs<'exercise_media'>>
export function visibleExerciseMedia<TAlias extends string>(
  caller: AccessContext,
  alias: TAlias,
): ReturnType<typeof exerciseMediaAs<TAlias>>
export function visibleExerciseMedia(caller: AccessContext, alias = 'exercise_media') {
  return exerciseMediaAs(caller, alias)
}

const workoutsAs = <TAlias extends string>(caller: AccessContext, alias: TAlias) =>
  qb.select().from(workouts).where(visible(workouts, caller)).as(alias)
export function visibleWorkouts(caller: AccessContext): ReturnType<typeof workoutsAs<'workouts'>>
export function visibleWorkouts<TAlias extends string>(
  caller: AccessContext,
  alias: TAlias,
): ReturnType<typeof workoutsAs<TAlias>>
export function visibleWorkouts(caller: AccessContext, alias = 'workouts') {
  return workoutsAs(caller, alias)
}

const workoutDaysAs = <TAlias extends string>(caller: AccessContext, alias: TAlias) =>
  qb.select().from(workoutDays).where(visible(workoutDays, caller)).as(alias)
export function visibleWorkoutDays(
  caller: AccessContext,
): ReturnType<typeof workoutDaysAs<'workout_days'>>
export function visibleWorkoutDays<TAlias extends string>(
  caller: AccessContext,
  alias: TAlias,
): ReturnType<typeof workoutDaysAs<TAlias>>
export function visibleWorkoutDays(caller: AccessContext, alias = 'workout_days') {
  return workoutDaysAs(caller, alias)
}

const workoutEntriesAs = <TAlias extends string>(caller: AccessContext, alias: TAlias) =>
  qb.select().from(workoutEntries).where(visible(workoutEntries, caller)).as(alias)
export function visibleWorkoutEntries(
  caller: AccessContext,
): ReturnType<typeof workoutEntriesAs<'workout_entries'>>
export function visibleWorkoutEntries<TAlias extends string>(
  caller: AccessContext,
  alias: TAlias,
): ReturnType<typeof workoutEntriesAs<TAlias>>
export function visibleWorkoutEntries(caller: AccessContext, alias = 'workout_entries') {
  return workoutEntriesAs(caller, alias)
}

const workoutSetsAs = <TAlias extends string>(caller: AccessContext, alias: TAlias) =>
  qb.select().from(workoutSets).where(visible(workoutSets, caller)).as(alias)
export function visibleWorkoutSets(
  caller: AccessContext,
): ReturnType<typeof workoutSetsAs<'workout_sets'>>
export function visibleWorkoutSets<TAlias extends string>(
  caller: AccessContext,
  alias: TAlias,
): ReturnType<typeof workoutSetsAs<TAlias>>
export function visibleWorkoutSets(caller: AccessContext, alias = 'workout_sets') {
  return workoutSetsAs(caller, alias)
}

/** Row shapes, for mappers. Identical to the tables' own: a relation selects every column. */
export type ExerciseRow = typeof exercises.$inferSelect
export type WorkoutRow = typeof workouts.$inferSelect
export type WorkoutSetRow = typeof workoutSets.$inferSelect
