import type { Page } from '../harness.ts'

/**
 * Which group a detail screen says its exercise or plan is in, and Move to group — the same on
 * both, under the test id `prefix`.
 */
export const placement = (page: Page, prefix: string) => {
  const owner = async (): Promise<string | null> => {
    await page.waitFor(`${prefix}-owner`)
    return await page.text(`${prefix}-owner`)
  }
  /** Opens the choice, and returns the button for `group` — failing with what was offered. */
  const choose = async (group: string): Promise<void> => {
    await page.click(`[data-testid="${prefix}"]`)
    const id = await page.evaluate(
      `[...document.querySelectorAll('[data-testid^="${prefix}-to-"]')].find((e) => e.innerText.trim() === ${JSON.stringify(`Move to ${group}`)})?.dataset.testid ?? null`,
    )
    if (typeof id !== 'string') throw new Error(`Move to ${group} is not offered`)
    await page.click(`[data-testid="${id}"]`)
  }
  return {
    /** "In Squad", or "In your personal group". */
    owner,
    /** The groups offered to move it into, by name — then the choice is closed again. */
    targets: async (): Promise<string[]> => {
      await page.click(`[data-testid="${prefix}"]`)
      const names = await page.evaluate(
        `[...document.querySelectorAll('[data-testid^="${prefix}-to-"]')].map((e) => e.innerText.trim().replace(/^Move to /, ''))`,
      )
      await page.click(`[data-testid="${prefix}-cancel"]`)
      return Array.isArray(names) ? names.map(String) : []
    },
    /** Moves it into `group`, and waits until it says it is there. */
    moveTo: async (group: string): Promise<void> => {
      await choose(group)
      await page.until(owner, (said) => said === `In ${group}`)
    },
    /** Tries to move it into `group`, and returns what it was refused for. */
    moveRefused: async (group: string): Promise<string | null> => {
      await choose(group)
      await page.waitFor(`${prefix}-error`)
      return await page.text(`${prefix}-error`)
    },
  }
}
