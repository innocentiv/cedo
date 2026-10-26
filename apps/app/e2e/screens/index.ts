import type { Page } from '../harness.ts'
import { auth } from './auth.ts'
import { groups } from './groups.ts'
import { install } from './install.ts'
import { exercise, library } from './library.ts'
import { nav } from './nav.ts'
import { picker } from './picker.ts'
import { progress } from './progress.ts'
import { planEditor, workouts } from './plan.ts'
import { session } from './session.ts'
import { settings } from './settings.ts'
import { today } from './today.ts'

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
  groups: groups(page),
  today: today(page),
  picker: picker(page),
  progress: progress(page),
  install: install(page),
})
