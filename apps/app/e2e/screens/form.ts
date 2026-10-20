import type { Page } from '../harness.ts'

/**
 * Waits for a form to close after Save — closed, not gone: a tab keeps its stack mounted. A refused
 * save fails with the form's own message rather than a timeout. Every form a driver saves waits
 * this way.
 */
export async function closed(page: Page, screen: string, error: string): Promise<void> {
  const state = await page.until(
    async () =>
      (await page.shown(error)) ? 'refused' : (await page.shown(screen)) ? 'open' : 'closed',
    (seen) => seen !== 'open',
  )
  if (state === 'refused') throw new Error(`Saving was refused: ${await page.text(error)}`)
}
