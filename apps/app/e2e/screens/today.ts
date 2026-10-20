import type { Page } from '../harness.ts'

/** Today: the session in progress, and the history of finished ones. */
export const today = (page: Page) => ({
  /**
   * The finished sessions Today shows, newest first, each by what it reads as — a day, or ad hoc.
   * Read where it stands, without a reload, so a journey can watch a cached history change; once it
   * has answered — rows, or "No history yet" — never before.
   */
  history: async (): Promise<string[]> => {
    await page.waitFor('today-screen')
    const titles = await page.until(
      async () =>
        await page.evaluate(
          `(() => {
            const shown = (e) => e.offsetParent != null
            const rows = [...document.querySelectorAll('[data-testid^="session-row-"]')].filter(shown)
            if (rows.length > 0) return rows.map((e) => e.innerText.split('\\n')[0].trim())
            const empty = document.querySelector('[data-testid="today-empty"]')
            return empty != null && shown(empty) ? [] : null
          })()`,
        ),
      (seen) => Array.isArray(seen),
    )
    return Array.isArray(titles) ? titles.map(String) : []
  },
})
