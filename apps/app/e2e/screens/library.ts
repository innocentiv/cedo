import type { OwnableScope } from '@cedo/contract'
import type { Page } from '../harness.ts'
import { closed } from './form.ts'
import { placement } from './placement.ts'

/** The exercise library: its list, an exercise's detail, and the form that creates or edits one. */

type FormScreen = 'exercise-new-screen' | 'exercise-edit-screen'

const exerciseForm = (page: Page, screen: FormScreen) => ({
  name: async (name: string): Promise<void> => {
    await page.fill('exercise-name', name)
  },
  /** Picks a muscle and gives it a share of the load. */
  load: async (muscle: string, percent: string): Promise<void> => {
    await page.click(`[data-testid="muscle-option-${muscle}"]`)
    await page.fill(`muscle-load-${muscle}`, percent)
  },
  /** The running total the form shows under the muscles. */
  total: async (): Promise<string> => (await page.text('muscle-total')) ?? '',
  attachVideo: async (url: string): Promise<void> => {
    await page.fill('media-url', url)
    await page.click('[data-testid="attach-media"]')
    await page.waitForSelector('[data-testid^="media-row-"]')
  },
  /** Saves, and waits for the form to close — see `closed`. */
  save: async (): Promise<void> => {
    await page.click(`[data-testid="${screen}-save"]`)
    await closed(page, screen, `${screen}-error`)
  },
  /** Saves a form the API will refuse, and returns the message it shows instead. */
  saveRefused: async (): Promise<string> => {
    await page.click(`[data-testid="${screen}-save"]`)
    await page.waitFor(`${screen}-error`)
    return (await page.text(`${screen}-error`)) ?? ''
  },
})

/** The exercise detail screen — reached however the journey reached it. */
export const exercise = (page: Page) => ({
  /** Which group it is in, and transferring it to another. */
  placement: placement(page, 'exercise-transfer'),
  /** Its progress, as the trend says it: the latest point in words, and a stall when there is one. */
  trend: async (): Promise<{
    first: string | null
    latest: string | null
    stalled: string | null
  }> => {
    await page.waitFor('exercise-trend')
    return {
      first: await page.text('exercise-trend-first'),
      latest: await page.text('exercise-trend-latest'),
      stalled: await page.text('exercise-trend-stalled'),
    }
  },
  shown: async (): Promise<void> => {
    await page.waitFor('exercise-detail-screen')
  },
  historyText: async (): Promise<string> => {
    await page.waitFor('exercise-history')
    return (await page.text('exercise-history')) ?? ''
  },
  edit: async () => {
    await page.waitFor('edit-exercise')
    await page.click('[data-testid="edit-exercise"]')
    await page.waitFor('exercise-edit-screen')
    return exerciseForm(page, 'exercise-edit-screen')
  },
  /** Deletes it, asked twice, and waits to be back where it was opened from. */
  delete: async (): Promise<void> => {
    await page.click('[data-testid="exercise-delete"]')
    await page.click('[data-testid="exercise-delete-confirm"]')
    await page.until(
      async () => await page.shown('exercise-detail-screen'),
      (shown) => !shown,
    )
  },
  /**
   * Asks to delete it, and returns what it says beside Delete it was refused for — once it asks
   * again: armed after a refusal, the next tap would send the same delete unasked.
   */
  deleteRefused: async (): Promise<string | null> => {
    await page.click('[data-testid="exercise-delete"]')
    await page.click('[data-testid="exercise-delete-confirm"]')
    await page.waitFor('exercise-delete-error')
    await page.waitFor('exercise-delete')
    return await page.text('exercise-delete-error')
  },
  /** Copies a shared exercise; lands in the editor for the copy. */
  duplicate: async () => {
    await page.waitFor('duplicate-exercise')
    await page.click('[data-testid="duplicate-exercise"]')
    await page.waitFor('exercise-edit-screen')
    return exerciseForm(page, 'exercise-edit-screen')
  },
})

export const library = (page: Page) => {
  const newExercise = async () => {
    await page.goto('/exercises/new')
    await page.waitFor('exercise-new-screen')
    return exerciseForm(page, 'exercise-new-screen')
  }
  const list = async (): Promise<void> => {
    await page.goto('/exercises')
    await page.waitFor('exercise-list')
  }
  const openRow = async () => {
    const row = await page.waitForSelector('[data-testid^="exercise-row-"]')
    await page.click(`[data-testid="${row}"]`)
    const detail = exercise(page)
    await detail.shown()
    return detail
  }
  return {
    newExercise,
    /** One exercise loading one muscle fully, through the form. */
    create: async (name: string, muscle: string): Promise<void> => {
      const form = await newExercise()
      await form.name(name)
      await form.load(muscle, '100')
      await form.save()
    },
    listText: async (): Promise<string> => {
      await list()
      return (await page.text('exercise-list')) ?? ''
    },
    openFirst: async () => {
      await list()
      return await openRow()
    },
    /** Searches the library tab as it stands — no reload — and opens the first match. */
    find: async (name: string) => {
      await page.waitFor('exercises-screen')
      await page.fill('exercise-search', name)
      return await openRow()
    },
    /** Filters the list by scope. */
    scope: async (scope: OwnableScope): Promise<void> => {
      await page.goto('/exercises')
      await page.waitFor('exercise-scope')
      await page.click(`[data-testid="exercise-scope-${scope}"]`)
    },
    emptyShown: async (): Promise<void> => {
      await page.waitFor('exercises-empty')
    },
    /** The scope chips' row height, in CSS pixels. */
    scopeHeight: async (): Promise<unknown> =>
      await page.evaluate(
        `document.querySelector('[data-testid="exercise-scope"]').getBoundingClientRect().height`,
      ),
  }
}
