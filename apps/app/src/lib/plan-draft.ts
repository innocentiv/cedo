import type { Workout, WorkoutDayInput, WorkoutEntryInput, WorkoutPlanInput } from '@cedo/contract'
import { NO_PROGRESSION } from '@cedo/contract'

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

/** A new entry starts with three working sets, which is what almost every prescription is. */
export const emptyEntry = (exerciseId: string): EntryDraft => ({
  exerciseId,
  supersetGroup: null,
  restSeconds: 120,
  progression: NO_PROGRESSION,
  sets: Array.from({ length: 3 }, () => ({
    targetReps: 8,
    targetWeightG: null,
    targetRpe: null,
    targetDurationS: null,
    targetDistanceMm: null,
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
