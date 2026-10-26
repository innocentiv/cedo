import type { Page } from '../harness.ts'

/** What only a desktop shows (#29): the sidebar's head and foot, and a list with its pane. */
export const desk = (page: Page) => ({
  /** The product's name, at the head of the sidebar. */
  name: async (): Promise<string | null> => await page.text('sidebar-name'),
  /** Who is signed in, at its foot. */
  account: async (): Promise<string> => (await page.text('sidebar-account')) ?? '',
  /** Chooses an exercise from the library, and returns its pane as it reads once it is open. */
  openExercise: async (search: string): Promise<string> => {
    await page.goto('/exercises')
    await page.fill('exercise-search', search)
    const row = await page.waitForSelector('[data-testid^="exercise-row-"]')
    await page.click(`[data-testid="${row}"]`)
    await page.waitFor('exercise-detail-pane')
    return (await page.text('exercise-pane')) ?? ''
  },
  /** Whether the list is still on screen, beside the pane. */
  listShown: async (): Promise<boolean> => await page.shown('exercise-list'),
})
