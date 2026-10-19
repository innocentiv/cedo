import type { Page } from '../harness.ts'
import { auth } from './auth.ts'
import { exercise, library } from './library.ts'
import { planEditor, workouts } from './plan.ts'
import { session } from './session.ts'
import { settings } from './settings.ts'

export { unique } from './auth.ts'

type Tab = 'today' | 'workouts' | 'exercises' | 'settings'

/**
 * The tab bar. A tab keeps its stack, so switching returns to the very screen left there — still
 * mounted, with its cache — where a `goto` would reload the page and empty it.
 */
const nav = (page: Page) => ({
  tab: async (tab: Tab): Promise<void> => {
    await page.click(`[data-testid="nav-${tab}"]`)
  },
  onToday: async (): Promise<void> => {
    await page.waitFor('today-screen')
  },
  /** Whether the app fell back to its error boundary. */
  crashed: async (): Promise<boolean> => await page.exists('error-boundary'),
})

/**
 * Every screen a journey drives, by what it is to the person using it. A journey reaches the app
 * only through these, so a test id lives in exactly one driver. See docs/10-testing.md.
 */
export const screens = (page: Page) => ({
  auth: auth(page),
  nav: nav(page),
  library: library(page),
  exercise: exercise(page),
  planEditor: planEditor(page),
  workouts: workouts(page),
  session: session(page),
  settings: settings(page),
})
