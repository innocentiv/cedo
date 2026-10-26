import type { Page } from '../harness.ts'

/**
 * The coach's view (#30): the athletes who share their training, and each one's — read-only. Their
 * Progress is the Progress tab's parts, and their history Today's rows: those drivers read them.
 */
export const athletes = (page: Page) => ({
  /** Whether the Athletes tab is offered — only to someone with an athlete sharing with them. */
  offered: async (): Promise<boolean> => await page.shown('nav-athletes'),
  /** Opens the tab and the athlete in it: their screen on a phone, the pane on a desktop. */
  open: async (athleteId: string): Promise<void> => {
    await page.click('[data-testid="nav-athletes"]')
    await page.waitFor(`athlete-row-${athleteId}`)
    await page.click(`[data-testid="athlete-row-${athleteId}"]`)
    await page.until(
      async () => (await page.shown('athlete-screen')) || (await page.shown('athlete-pane')),
      (open) => open,
    )
  },
  /** Whether the list of athletes is on screen — beside the one open, on a desktop. */
  listShown: async (): Promise<boolean> => await page.shown('athlete-pane-card'),
  /** The session they are in now, as its row reads. */
  trainingNow: async (): Promise<string> => {
    await page.waitFor('athlete-training-now')
    return (await page.text('athlete-training-now')) ?? ''
  },
  /** Opens the session they are in now: its sets so far. */
  openTrainingNow: async (): Promise<void> => {
    await page.click('[data-testid="athlete-training-now"]')
    await page.waitFor('athlete-session-screen')
  },
  /** The session's sets by exercise, as they read. */
  sets: async (): Promise<string> => {
    await page.waitFor('session-logs')
    return (await page.text('session-logs')) ?? ''
  },
  /** From a session, their history of one exercise: its trend and sessions. */
  historyOf: async (exerciseId: string): Promise<void> => {
    await page.click(`[data-testid="exercise-history-of-${exerciseId}"]`)
    await page.waitFor('athlete-exercise-screen')
  },
  /** Back from a session of theirs to where it was opened. */
  back: async (): Promise<void> => {
    await page.click('[data-testid="athlete-session-header-back"]')
  },
})
