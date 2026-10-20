import type { Page } from '../harness.ts'

/** The exercise picker, wherever it is opened from — a plan entry, a session without a plan. */
export const picker = (page: Page) => ({
  /** Searches, picks the first match, and returns its exercise id. */
  pick: async (search: string): Promise<string> => {
    await page.waitFor('exercise-picker')
    await page.fill('picker-search', search)
    const picked = await page.waitForSelector('[data-testid^="picker-row-"]')
    await page.click(`[data-testid="${picked}"]`)
    return picked.replace('picker-row-', '')
  },
})
