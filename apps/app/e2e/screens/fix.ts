import type { Page } from '../harness.ts'

/**
 * A set fixed (#31), from the session's list — in progress or finished alike: a set opened by
 * tapping it, right below itself (#63), its numbers corrected or the set removed — and a finished
 * session deleted whole, each removal asked twice.
 */
export const fix = (page: Page) => {
  const closed = async (): Promise<void> => {
    await page.until(
      async () => await page.shown('fix-set'),
      (open) => !open,
    )
  }
  return {
    /** Opens a set of the summary by its row's id, as `session.loggedIds` reads them. */
    open: async (rowId: string): Promise<void> => {
      await page.click(`[data-testid="${rowId}"]`)
      await page.waitFor('fix-set')
    },
    /** The row the set opened under, by its id: the one tapped, and nowhere else. */
    under: async (): Promise<string | null> => {
      const id = await page.evaluate(
        `document.querySelector('[data-testid="fix-set"]')?.previousElementSibling?.dataset.testid ?? null`,
      )
      return typeof id === 'string' ? id : null
    },
    value: async (dimension: 'weight' | 'reps' | 'duration' | 'distance'): Promise<unknown> =>
      await page.value(`fix-set-${dimension}`),
    fill: async (dimension: 'weight' | 'reps' | 'duration' | 'distance', text: string) => {
      await page.fill(`fix-set-${dimension}`, text)
    },
    save: async (): Promise<void> => {
      await page.click('[data-testid="fix-set-save"]')
      await closed()
    },
    remove: async (): Promise<void> => {
      await page.click('[data-testid="fix-set-remove"]')
      await page.click('[data-testid="fix-set-remove-confirm"]')
      await closed()
    },
    /** Deletes the open session, asked twice: the screen goes back to where it was opened from. */
    deleteSession: async (): Promise<void> => {
      await page.click('[data-testid="delete-session"]')
      await page.click('[data-testid="delete-session-confirm"]')
      await page.until(
        async () => await page.shown('session-finished'),
        (open) => !open,
      )
    },
  }
}
