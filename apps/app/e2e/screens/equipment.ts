import type { Page } from '../harness.ts'
import { linesOf } from './lines.ts'
import { nav } from './nav.ts'

/** Settings → Equipment (#34): what you have to train with, and how its weights go. */
export const equipment = (page: Page) => ({
  /** What the Settings tab says of it, under its title: undescribed, or how many items. */
  said: async (): Promise<string[]> => {
    await nav(page).tab('settings')
    await page.waitFor('settings-equipment')
    return (await linesOf(page, 'settings-equipment')).slice(1)
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
  /**
   * Types one of an item's weights over what the field held: its first key replacing it, the rest
   * key by key — so a half-typed "2." passes through the field as it would under a thumb.
   */
  type: async (slug: string, key: 'minG' | 'stepG' | 'maxG', text: string): Promise<void> => {
    await page.fill(`weights-${slug}-${key}`, text.slice(0, 1))
    await page.keys(text.slice(1).split(''))
  },
  /** Empties one of an item's weights. */
  empty: async (slug: string, key: 'minG' | 'stepG' | 'maxG'): Promise<void> => {
    await page.fill(`weights-${slug}-${key}`, '')
  },
  /** Saves, and waits to be back on Settings. */
  save: async (): Promise<void> => {
    await page.click('[data-testid="equipment-save"]')
    await page.until(
      async () => await page.shown('equipment-screen'),
      (open) => !open,
    )
  },
  /** Saves weights left half typed, and returns why the screen will not. */
  saveRefused: async (): Promise<string | null> => {
    await page.click('[data-testid="equipment-save"]')
    await page.waitFor('equipment-error')
    return await page.text('equipment-error')
  },
})
