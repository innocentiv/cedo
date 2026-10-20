import type { Page } from '../harness.ts'

type Tab = 'today' | 'workouts' | 'exercises' | 'settings'

/**
 * The tab bar, and the screen each tab opens on. A tab keeps its stack, so switching returns to the
 * very screen left there — still mounted, with its cache — where a `goto` would reload the page and
 * empty it.
 */
export const nav = (page: Page) => ({
  tab: async (tab: Tab): Promise<void> => {
    await page.click(`[data-testid="nav-${tab}"]`)
  },
  onToday: async (): Promise<void> => {
    await page.waitFor('today-screen')
  },
  /** Whether the app fell back to its error boundary. */
  crashed: async (): Promise<boolean> => await page.exists('error-boundary'),
})
