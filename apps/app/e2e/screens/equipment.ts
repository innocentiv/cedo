import type { Page } from '../harness.ts'
import { nav } from './nav.ts'

/** Settings → Equipment (#34): what you have to train with, and how its weights go. */
export const equipment = (page: Page) => {
  const lines = async (testID: string): Promise<string[]> =>
    String(
      await page.evaluate(`document.querySelector('[data-testid="${testID}"]')?.innerText ?? ''`),
    )
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  return {
    /** What the Settings tab says of it, under its title: undescribed, or how many items. */
    said: async (): Promise<string[]> => {
      await nav(page).tab('settings')
      await page.waitFor('settings-equipment')
      return (await lines('settings-equipment')).slice(1)
    },
    /** From the Settings tab, as someone would. */
    open: async (): Promise<void> => {
      await nav(page).tab('settings')
      await page.click('[data-testid="manage-equipment"]')
      await page.waitFor('equipment-screen')
      await page.waitFor('equipment-save')
    },
    /** Ticks an item, or unticks it. */
    have: async (slug: string): Promise<void> => {
      await page.click(`[data-testid="have-${slug}"]`)
    },
    /** Ticks a shortcut's items: 0 is the cable column, 1 the bench, 2 a full gym. */
    shortcut: async (at: number): Promise<void> => {
      await page.click(`[data-testid="equipment-shortcut-${String(at)}"]`)
    },
    /** The items ticked, by slug, in the checklist's order. */
    ticked: async (): Promise<string[]> =>
      String(
        await page.evaluate(
          `[...document.querySelectorAll('[data-testid^="have-"][aria-selected="true"]')].map((e) => e.dataset.testid.slice(5)).join(',')`,
        ),
      )
        .split(',')
        .filter((slug) => slug !== ''),
    /** An item's weights as its fields hold them: from, step, to. */
    weights: async (slug: string): Promise<unknown[]> => {
      // One at a time: the page answers one evaluate at once.
      const values: unknown[] = []
      for (const key of ['minG', 'stepG', 'maxG']) {
        values.push(await page.value(`weights-${slug}-${key}`))
      }
      return values
    },
    /** Fills one of an item's weights, replacing what the field held. */
    type: async (slug: string, key: 'minG' | 'stepG' | 'maxG', text: string): Promise<void> => {
      await page.fill(`weights-${slug}-${key}`, text)
    },
    /** Saves, and waits to be back on Settings. */
    save: async (): Promise<void> => {
      await page.click('[data-testid="equipment-save"]')
      await page.until(
        async () => await page.shown('equipment-screen'),
        (open) => !open,
      )
    },
  }
}
