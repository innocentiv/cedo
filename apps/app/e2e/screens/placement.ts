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
  /** Opens the choice, once it is shown: each group offered, by its button's title and test id. */
  const offered = async (): Promise<{ title: string; id: string }[]> => {
    await page.click(`[data-testid="${prefix}"]`)
    await page.waitFor(`${prefix}-targets`)
    const buttons = await page.evaluate(
      `[...document.querySelectorAll('[data-testid^="${prefix}-to-"]')].map((e) => ({ title: e.innerText.trim(), id: e.dataset.testid }))`,
    )
    return Array.isArray(buttons) ? (buttons as { title: string; id: string }[]) : []
  }
  const choose = async (group: string): Promise<void> => {
    const choices = await offered()
    const chosen = choices.find((c) => c.title === `Move to ${group}`)
    if (chosen === undefined) {
      throw new Error(`Move to ${group} is not offered: ${choices.map((c) => c.title).join(', ')}`)
    }
    await page.click(`[data-testid="${chosen.id}"]`)
  }
  return {
    /** "In Squad", or "In your personal group". */
    owner,
    /** Whether Move to group is offered at all — once the screen says where it is. */
    canMove: async (): Promise<boolean> => {
      await owner()
      return await page.exists(prefix)
    },
    /** The groups offered to move it into, by name — then the choice is closed again. */
    targets: async (): Promise<string[]> => {
      const choices = await offered()
      await page.click(`[data-testid="${prefix}-cancel"]`)
      return choices.map((c) => c.title.replace(/^Move to /u, ''))
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
