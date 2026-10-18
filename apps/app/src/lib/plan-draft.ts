import type { Workout, WorkoutDayInput, WorkoutEntryInput, WorkoutPlanInput } from '@cedo/contract'
import { planInputFrom } from '@cedo/contract'

/**
 * The plan editor's working copy.
 *
 * `PUT /workouts/:id/plan` replaces the entire plan in one transaction, so the editor holds the
 * whole thing and sends it once. Indices are array position and are assigned by the server, which
 * is why nothing here carries one — reordering is a plain array move.
 * See docs/06-api.md.
 *
 * Pure functions over plain data: no React, no network. The RULES of editing a plan — new days and
 * entries, set counts, limits, what a target change applies to — are the contract's
 * (`plan-editing.ts`), where they are tested; this file only moves draft data around.
 */

export type DayDraft = WorkoutDayInput
export type EntryDraft = WorkoutEntryInput

/**
 * Carries every day's and entry's id, so saving keeps the logged history attached to them — see
 * `planInputFrom`. A day or entry the editor adds has none, and becomes a new one on save.
 */
export const draftFrom = (workout: Workout): DayDraft[] => planInputFrom(workout).days

export const toPlanInput = (days: readonly DayDraft[]): WorkoutPlanInput => ({ days: [...days] })

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
