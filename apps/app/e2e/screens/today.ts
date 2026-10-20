import type { Page } from '../harness.ts'

/** Today: the session in progress, and the history of finished ones. */
export const today = (page: Page) => ({
  /** The finished sessions listed, newest first, each by what it reads as — a day, or ad hoc. */
  history: async (): Promise<string[]> => {
    await page.goto('/today')
    await page.waitFor('today-screen')
    const titles = await page.evaluate(
      `[...document.querySelectorAll('[data-testid^="session-row-"]')].filter((e) => e.offsetParent != null).map((e) => e.innerText.split('\\n')[0].trim())`,
    )
    return Array.isArray(titles) ? titles.map(String) : []
  },
})
