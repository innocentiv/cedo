import type { Page } from '../harness.ts'
import { linesOf } from './lines.ts'

/**
 * The coach's view (#30): the athletes who share their training, and each one's — read-only. Their
 * Progress is the Progress tab's parts, their history Today's rows, and a session's sets the
 * session's list: those drivers read them.
 */
export const athletes = (page: Page) => ({
  /** From the Athletes tab, opens one: their screen on a phone, the pane on a desktop. */
  open: async (athleteId: string): Promise<void> => {
    await page.waitFor(`athlete-row-${athleteId}`)
    await page.click(`[data-testid="athlete-row-${athleteId}"]`)
    await page.until(
      async () => (await page.shown('athlete-screen')) || (await page.shown('athlete-pane')),
      (open) => open,
    )
  },
  /** Whether the athlete's row in the list is on screen — beside them, on a desktop. */
  listed: async (athleteId: string): Promise<boolean> =>
    await page.shown(`athlete-row-${athleteId}`),
  /** What they have to train with, as their Equipment card reads it under its label (#34). */
  equipment: async (): Promise<string[]> => {
    await page.waitFor('athlete-equipment')
    return (await linesOf(page, 'athlete-equipment')).slice(1)
  },
  /** The session they are in now, as its row reads. */
  trainingNow: async (): Promise<string> => {
    await page.waitFor('athlete-training-now')
    return (await page.text('athlete-training-now')) ?? ''
  },
  /** Whether a session of theirs is in progress, as the page last read it. */
  inTraining: async (): Promise<boolean> => await page.shown('athlete-training-now'),
  /** Under their name: who they are, whom they share through, and their age once said (#42). */
  about: async (): Promise<string> => (await page.text('athlete-about')) ?? '',
  /** Opens the session they are in now: its sets so far. */
  openTrainingNow: async (): Promise<void> => {
    await page.click('[data-testid="athlete-training-now"]')
    await page.waitFor('athlete-session-screen')
  },
  /** Their notes on the session open, as written. */
  notes: async (): Promise<string | null> => {
    await page.waitFor('session-notes-read')
    return await page.text('session-notes-read')
  },
  /** Which exercises of the session open their history: those the coach can see, by id. */
  historyLinks: async (): Promise<string[]> => {
    const ids = await page.evaluate(
      `[...document.querySelectorAll('[data-testid^="exercise-history-of-"]')].map((e) => e.dataset.testid.slice('exercise-history-of-'.length))`,
    )
    return Array.isArray(ids) ? ids.map(String) : []
  },
  /** From a session, their history of one exercise: its trend and sessions. */
  historyOf: async (exerciseId: string): Promise<void> => {
    await page.click(`[data-testid="exercise-history-of-${exerciseId}"]`)
    await page.waitFor('athlete-exercise-screen')
  },
  /** Waits until their page says it is theirs no more. */
  gone: async (): Promise<void> => {
    await page.waitFor('athlete-gone')
  },
  /** Back from their history of an exercise to the session it was opened from. */
  backFromExercise: async (): Promise<void> => {
    await page.click('[data-testid="athlete-exercise-screen-back"]')
  },
  /** Back from a session of theirs to where it was opened. */
  back: async (): Promise<void> => {
    await page.click('[data-testid="athlete-session-header-back"]')
  },
})
