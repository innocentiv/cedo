import type { OwnableScope } from '@cedo/contract'
import type { Page } from '../harness.ts'
import { closed } from './form.ts'
import { picker } from './picker.ts'
import { placement } from './placement.ts'
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
  /** The reps to leave in reserve, as offered: `2`, `1.5`, or `none`. */
  reserve: async (reps: string): Promise<void> => {
    await page.click(`[data-testid="${id}-reserve-${reps}"]`)
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
    /** Which group the open plan is in, and moving it to another. */
    placement: placement(page, 'workout-transfer'),
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
    /** Waits for the plan to say a session is in progress — in place of its Start buttons. */
    inProgressShown: async (): Promise<void> => {
      await page.waitFor('workout-in-progress')
    },
    canStart: async (day: number): Promise<boolean> => await page.exists(`start-day-${day}`),
    /** Pins the plan, and waits until it says so. */
    pin: async (): Promise<void> => {
      await page.click('[data-testid="workout-pin"]')
      await page.until(
        async () => await page.text('workout-pin'),
        (title) => title?.includes('Pinned') === true,
      )
    },
    /** Deletes the plan, asked twice, and waits to be back where it was opened from. */
    delete: async (): Promise<void> => {
      await page.click('[data-testid="workout-delete"]')
      await page.click('[data-testid="workout-delete-confirm"]')
      await page.until(
        async () => await page.shown('workout-detail-screen'),
        (open) => !open,
      )
    },
    /** Asks to delete it, and returns what it says beside Delete it was refused for. */
    deleteRefused: async (): Promise<string | null> => {
      await page.click('[data-testid="workout-delete"]')
      await page.click('[data-testid="workout-delete-confirm"]')
      await page.waitFor('workout-delete-error')
      await page.waitFor('workout-delete')
      return await page.text('workout-delete-error')
    },
    /** The plans listed under a scope — `favourites` is shown as Pinned. */
    listed: async (scope: OwnableScope): Promise<string[]> => {
      await page.goto('/workouts')
      await page.click(`[data-testid="workout-scope-${scope}"]`)
      return await workouts(page).showing()
    },
    /**
     * The plans the list shows where it stands — no reload, so a journey can watch a cached list
     * change — once it has answered: rows, or "No plans yet".
     */
    showing: async (): Promise<string[]> => {
      const names = await page.until(
        async () =>
          await page.evaluate(
            `document.querySelector('[data-testid="workouts-empty"]') ? [] : document.querySelector('[data-testid="workout-list"]') ? [...document.querySelectorAll('[data-testid^="workout-row-"]')].map((e) => e.innerText.split('\\n')[0].trim()) : null`,
          ),
        (seen) => Array.isArray(seen),
      )
      return Array.isArray(names) ? names.map(String) : []
    },
    /** Opens the session in progress from the plan. */
    resume: async (): Promise<void> => {
      await page.click('[data-testid="workout-resume"]')
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
