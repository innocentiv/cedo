import type { Page } from '../harness.ts'

/**
 * A finished session's past mistakes fixed (#31), from its summary: a set opened by tapping it, its
 * numbers corrected or the set removed — and the whole session deleted, each removal asked twice.
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
    /** The set's title on its sheet — "Barbell Back Squat · Set 1": its first line as it reads. */
    title: async (): Promise<string> =>
      String(
        await page.evaluate(
          `document.querySelector('[data-testid="fix-set"]').innerText.split('\\n')[0].trim()`,
        ),
      ),
    fill: async (dimension: 'weight' | 'reps' | 'duration' | 'distance', text: string) => {
      await page.fill(`fix-set-${dimension}`, text)
    },
    warmup: async (): Promise<void> => {
      await page.click('[data-testid="fix-set-kind-warmup"]')
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
