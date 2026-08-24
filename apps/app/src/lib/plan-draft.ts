import type {
  Exercise,
  Workout,
  WorkoutDayInput,
  WorkoutEntryInput,
  WorkoutPlanInput,
} from '@cedo/contract'
import { NO_PROGRESSION, tracks } from '@cedo/contract'

/**
 * The plan editor's working copy.
 *
 * `PUT /workouts/:id/plan` replaces the entire plan in one transaction, so the editor holds the
 * whole thing and sends it once. Indices are array position and are assigned by the server, which
 * is why nothing here carries one — reordering is a plain array move.
 * See docs/06-api.md.
 *
 * Pure functions over plain data: no React, no network, so the reducer logic stays testable and the
 * screen keeps no rules of its own.
 */

export type DayDraft = WorkoutDayInput
export type EntryDraft = WorkoutEntryInput

export function draftFrom(workout: Workout): DayDraft[] {
  return workout.days.map((day) => ({
    name: day.name,
    entries: day.entries.map((entry) => ({
      exerciseId: entry.exerciseId,
      supersetGroup: entry.supersetGroup,
      restSeconds: entry.restSeconds,
      progression: entry.progression,
      sets: entry.sets.map((set) => ({
        targetReps: set.target.reps,
        targetWeightG: set.target.weightG,
        targetRpe: set.target.rpe,
        targetDurationS: set.target.durationS,
        targetDistanceMm: set.target.distanceMm,
        isWarmup: set.isWarmup,
      })),
    })),
  }))
}

export const toPlanInput = (days: readonly DayDraft[]): WorkoutPlanInput => ({ days: [...days] })

export const emptyDay = (index: number): DayDraft => ({
  name: `Day ${index + 1}`,
  entries: [],
})

/**
 * A new entry starts with three working sets, which is what almost every prescription is — and with
 * a target in whatever the exercise actually measures.
 *
 * Seeding `targetReps` regardless left a plank with three sets and an empty Seconds box: a required
 * field, blank, with nothing saying what belongs in it. The mode is known here because the picker
 * hands back the whole exercise.
 */
export const emptyEntry = (exercise: Exercise): EntryDraft => ({
  exerciseId: exercise.id,
  supersetGroup: null,
  restSeconds: 120,
  progression: NO_PROGRESSION,
  sets: Array.from({ length: 3 }, () => ({
    targetReps: tracks(exercise.tracking, 'reps') ? 8 : null,
    targetWeightG: null,
    targetRpe: null,
    targetDurationS: tracks(exercise.tracking, 'duration') ? 30 : null,
    targetDistanceMm: tracks(exercise.tracking, 'distance') ? 100_000 : null,
    isWarmup: false,
  })),
})

export function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, i) => (i === index ? next : item))
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index)
}

/** Reordering is a move, because indices are array position. Out-of-range moves are a no-op. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return [...items]
  const copy = [...items]
  const [moved] = copy.splice(from, 1)
  if (moved === undefined) return [...items]
  copy.splice(to, 0, moved)
  return copy
}
