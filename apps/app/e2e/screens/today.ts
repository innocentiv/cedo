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
  /** The next day Today offers to start — null when it offers none. */
  nextDay: async (): Promise<string | null> => {
    await page.waitFor('today-screen')
    await page.until(
      async () => (await page.shown('today-next')) || (await page.shown('today-start')),
      (either) => either,
    )
    return await page.text('today-next-day')
  },
  /** Starts the next day, in one tap, and waits for its session. */
  startNext: async (): Promise<void> => {
    await page.click('[data-testid="today-start-next"]')
    await page.waitFor('session-screen')
  },
  /** "2 sessions this week": the count, as the strip's heading says it. */
  weekCount: async (): Promise<string | null> => {
    await page.waitFor('today-week-count')
    return await page.text('today-week-count')
  },
  /** Opens the history row at `index`, newest first: its session's summary. */
  open: async (index: number): Promise<void> => {
    await page.evaluate(
      `[...document.querySelectorAll('[data-testid^="session-row-"]')].filter((e) => e.offsetParent != null)[${String(index)}].click()`,
    )
    await page.waitFor('session-finished')
  },
  /** Each history row as it reads, its lines joined: `A | Sat 25 Oct · 0 min · 1 set | PB`. */
  rows: async (): Promise<string[]> => {
    const rows = await page.evaluate(
      `[...document.querySelectorAll('[data-testid^="session-row-"]')].filter((e) => e.offsetParent != null).map((e) => e.innerText.split('\\n').map((l) => l.trim()).filter(Boolean).join(' | '))`,
    )
    return Array.isArray(rows) ? rows.map(String) : []
  },
})
