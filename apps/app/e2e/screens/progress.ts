import type { Page } from '../harness.ts'

/** Progress (#28): your training reviewed. */
export const progress = (page: Page) => ({
  shown: async (): Promise<void> => {
    await page.waitFor('progress-consistency')
  },
  /** Sessions a week, as the screen says it. */
  perWeek: async (): Promise<string | null> => await page.text('progress-per-week'),
  /** What needs attention, as it reads: stalled, falling, harder each time — or that nothing is. */
  attention: async (): Promise<string> => (await page.text('progress-attention')) ?? '',
  /** Looks back over another period: `4`, `8` or `12` weeks. */
  period: async (weeks: string): Promise<void> => {
    await page.click(`[data-testid="progress-weeks-${weeks}"]`)
  },
})
