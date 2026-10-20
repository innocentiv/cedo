import type { Page } from '../harness.ts'
import { closed } from './form.ts'
import { picker } from './picker.ts'
import { session } from './session.ts'

/** Plans: the list, a plan's detail, and the editor. */

/** A numeric field of a plan entry: a dimension, or `sets` / `warmups`. */
type EntryField = 'weight' | 'reps' | 'duration' | 'distance' | 'sets' | 'warmups'

const planEntry = (page: Page, id: string) => ({
  text: async (): Promise<string> => (await page.text(id)) ?? '',
  has: async (field: EntryField): Promise<boolean> => await page.exists(`${id}-${field}`),
  /** Taps a field, which selects its text: the next key replaces it. */
  focus: async (field: EntryField): Promise<void> => {
    await page.click(`[data-testid="${id}-${field}"]`)
  },
  value: async (field: EntryField): Promise<unknown> => await page.value(`${id}-${field}`),
  progression: async (kind: string): Promise<void> => {
    await page.click(`[data-testid="${id}-progression-${kind}"]`)
  },
  progressionSummary: async (): Promise<string | null> =>
    await page.text(`${id}-progression-summary`),
  /** Its sets and prescription, for an entry shown read-only. */
  target: async (): Promise<string | null> => await page.text(`${id}-target`),
  /** Whether it is shown as an unavailable exercise. */
  unavailable: async (): Promise<boolean> => await page.exists(`${id}-unavailable`),
  remove: async (): Promise<void> => {
    await page.click(`[data-testid="${id}-remove"]`)
  },
})

/** The plans list, and a plan's detail. */
export const workouts = (page: Page) => {
  const shown = async (): Promise<void> => {
    await page.waitFor('workout-detail-screen')
  }
  return {
    /** Opens the first plan in the list on screen. */
    openFirst: async (): Promise<void> => {
      const row = await page.waitForSelector('[data-testid^="workout-row-"]')
      await page.click(`[data-testid="${row}"]`)
      await shown()
    },
    /** Waits for a plan's detail. */
    shown,
    detailText: async (): Promise<string> => {
      await shown()
      return (await page.text('workout-detail-screen')) ?? ''
    },
    startDay: async (day: number): Promise<void> => {
      await page.click(`[data-testid="start-day-${day}"]`)
      await session(page).shown()
    },
  }
}

export const planEditor = (page: Page) => {
  /**
   * Saves, and waits for the editor to close — back to wherever it was opened from: the list, for a
   * new plan; Today, for one opened by its address. Closed, not gone: a tab keeps its stack mounted.
   */
  const save = async (): Promise<void> => {
    await page.click('[data-testid="save-plan"]')
    await closed(page, 'plan-edit-screen', 'plan-edit-error')
  }
  return {
    /**
     * A new plan with one day around the first exercise matching `exercise`, open in the editor.
     * From the shared library by default, so no exercise has to be created first. Returns the
     * exercise's id.
     */
    create: async (exercise = 'Bench', name = 'Push Day'): Promise<string> => {
      await page.goto('/workouts')
      await page.waitFor('workouts-screen')
      await page.fill('workout-name', name)
      await page.click('[data-testid="create-workout"]')

      await page.waitFor('plan-edit-screen')
      await page.click('[data-testid="add-day"]')
      await page.waitFor('plan-day-0')
      await page.click('[data-testid="add-entry-0"]')
      const exerciseId = await picker(page).pick(exercise)
      await page.waitFor('plan-entry-0-0')
      return exerciseId
    },
    /** An existing plan, opened in the editor by its address. */
    open: async (workoutId: string): Promise<void> => {
      await page.goto(`/workouts/${workoutId}/edit`)
      await page.waitFor('plan-edit-screen')
    },
    entry: (day: number, index: number) => planEntry(page, `plan-entry-${day}-${index}`),
    /** Taps a day's name: a plain text input, so the caret lands where the tap did. */
    focusDayName: async (day: number): Promise<void> => {
      await page.click(`[data-testid="day-name-${day}"]`)
    },
    /** What the footer says the schema would refuse, or null when it says nothing. */
    issues: async (): Promise<string | null> =>
      (await page.exists('plan-issues')) ? await page.text('plan-issues') : null,
    canSave: async (): Promise<boolean> =>
      (await page.evaluate(
        `document.querySelector('[data-testid="save-plan"]').getAttribute('aria-disabled')`,
      )) !== 'true',
    save,
    /** Saves, opens the plan, and starts its first day. */
    saveAndStart: async (): Promise<void> => {
      await save()
      await workouts(page).openFirst()
      await workouts(page).startDay(0)
    },
  }
}
