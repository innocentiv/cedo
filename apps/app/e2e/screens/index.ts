import type { Page } from '../harness.ts'
import { auth } from './auth.ts'
import { exercise, library } from './library.ts'
import { nav } from './nav.ts'
import { planEditor, workouts } from './plan.ts'
import { session } from './session.ts'
import { settings } from './settings.ts'

export { unique } from './auth.ts'

/**
 * Every screen a journey drives, by what it is to the person using it — a driver per screen,
 * grouped by area. A journey reaches the app only through these, so a test id lives in exactly one
 * driver. See docs/10-testing.md.
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
