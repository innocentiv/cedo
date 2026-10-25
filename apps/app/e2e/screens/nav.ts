import type { Page } from '../harness.ts'

type Tab = 'today' | 'workouts' | 'exercises' | 'settings'

/**
 * The tab bar, and the screen each tab opens on. A tab keeps its stack, so switching returns to the
 * very screen left there — still mounted, with its cache — where a `goto` would reload the page and
 * empty it.
 */
export const nav = (page: Page) => ({
  /**
   * Switches tab. A session in progress has the app to itself (#24), so from its screen this leaves
   * it open first — its header's back — as an athlete would.
   */
  tab: async (tab: Tab): Promise<void> => {
    if (!(await page.shown(`nav-${tab}`)) && (await page.shown('session-header-back'))) {
      await page.click('[data-testid="session-header-back"]')
      await page.until(
        async () => await page.shown(`nav-${tab}`),
        (shown) => shown,
      )
    }
    await page.click(`[data-testid="nav-${tab}"]`)
  },
  onToday: async (): Promise<void> => {
    await page.waitFor('today-screen')
  },
  /** Whether the app fell back to its error boundary. */
  crashed: async (): Promise<boolean> => await page.exists('error-boundary'),
})
