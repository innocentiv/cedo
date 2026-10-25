import type { Page } from '../harness.ts'

/**
 * The exercise picker, wherever it is opened from — a plan's day, a session (#27): what was logged
 * lately first, then the library; several chosen, then added together.
 */
export const picker = (page: Page) => {
  /** Searches, and chooses the first match; returns its exercise id. */
  const choose = async (search: string): Promise<string> => {
    await page.waitFor('exercise-picker')
    await page.fill('picker-search', search)
    const row = await page.waitForSelector('[data-testid^="picker-row-"]')
    await page.click(`[data-testid="${row}"]`)
    return row.replace('picker-row-', '')
  }
  const add = async (): Promise<void> => {
    await page.click('[data-testid="picker-add"]')
  }
  return {
    /** Searches, chooses the first match, adds it, and returns its exercise id. */
    pick: async (search: string): Promise<string> => {
      const id = await choose(search)
      await add()
      return id
    },
    /** Chooses the first match of each search, in order, and adds them together. */
    pickAll: async (searches: readonly string[]): Promise<string[]> => {
      const ids: string[] = []
      for (const search of searches) {
        // oxlint-disable-next-line no-await-in-loop -- one search at a time, in the order chosen.
        ids.push(await choose(search))
      }
      await add()
      return ids
    },
    /** What it leads with, by name — before anything is searched. */
    recent: async (): Promise<string[]> => {
      await page.waitFor('exercise-picker')
      if (!(await page.shown('picker-recent'))) return []
      const names = await page.evaluate(
        `[...document.querySelectorAll('[data-testid^="picker-recent-"][data-testid$="-name"]')].map((e) => e.innerText.trim())`,
      )
      return Array.isArray(names) ? names.map(String) : []
    },
    /** What a searched row says of itself, its lines joined: `Bench | In this day · Chest`. */
    row: async (search: string): Promise<string> => {
      await page.fill('picker-search', search)
      const row = await page.waitForSelector('[data-testid^="picker-row-"]')
      return ((await page.text(row)) ?? '')
        .split('\n')
        .map((l) => l.trim())
        .join(' | ')
    },
  }
}
