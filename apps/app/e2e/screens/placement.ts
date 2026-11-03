import type { Page } from '../harness.ts'

/**
 * The line under an exercise's or a plan's name: which group it is in, its pin, and Transfer to group
 * — the same on both, under the test id `prefix`, its pin under `pin`.
 */
export const placement = (page: Page, prefix: string, pin: string) => {
  const owner = async (): Promise<string | null> => {
    await page.waitFor(`${prefix}-owner`)
    return await page.text(`${prefix}-owner`)
  }
  /** Opens the choice, once it is shown: each group offered, by its button's title and test id. */
  const offered = async (): Promise<{ title: string; id: string }[]> => {
    await page.click(`[data-testid="${prefix}"]`)
    await page.waitFor(`${prefix}-targets`)
    const buttons = await page.evaluate(
      `[...document.querySelectorAll('[data-testid^="${prefix}-to-"]:not([data-testid$="-error"])')].map((e) => ({ title: e.innerText.trim(), id: e.dataset.testid }))`,
    )
    return Array.isArray(buttons) ? (buttons as { title: string; id: string }[]) : []
  }
  const choose = async (group: string): Promise<void> => {
    const choices = await offered()
    const chosen = choices.find((c) => c.title === `Transfer to ${group}`)
    if (chosen === undefined) {
      throw new Error(
        `Transfer to ${group} is not offered: ${choices.map((c) => c.title).join(', ')}`,
      )
    }
    // Asked twice: every transfer has a shared group on one side.
    await page.click(`[data-testid="${chosen.id}"]`)
    await page.click(`[data-testid="${chosen.id}-confirm"]`)
  }
  /** What a tap on the pin would do, as it says aloud: "Pin", or "Unpin" once pinned. */
  const pinSays = async (): Promise<unknown> =>
    await page.evaluate(
      `document.querySelector('[data-testid="${pin}"]').getAttribute('aria-label')`,
    )
  return {
    /** "In Squad", or "In your personal group". */
    owner,
    /** Pins it, and waits until the star says it is pinned. */
    pin: async (): Promise<void> => {
      await page.click(`[data-testid="${pin}"]`)
      await page.until(pinSays, (says) => says === 'Unpin')
    },
    /**
     * Whether where it is, its pin and any transfer share one line — each centred within a few
     * pixels of the others — rather than each a row of its own.
     */
    oneLine: async (): Promise<boolean> => {
      await owner()
      const centres = await page.evaluate(
        `['${prefix}-owner', '${pin}', '${prefix}'].map((id) => document.querySelector('[data-testid="' + id + '"]')).filter((e) => e !== null).map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2 })`,
      )
      if (!Array.isArray(centres) || centres.length < 2) return false
      const ys = centres as number[]
      return Math.max(...ys) - Math.min(...ys) < 4
    },
    /** Whether Transfer to group is offered at all — once the screen says where it is. */
    canTransfer: async (): Promise<boolean> => {
      await owner()
      return await page.exists(prefix)
    },
    /** The groups offered to transfer it into, by name — then the choice is closed again. */
    targets: async (): Promise<string[]> => {
      const choices = await offered()
      await page.click(`[data-testid="${prefix}-cancel"]`)
      return choices.map((c) => c.title.replace(/^Transfer to /u, ''))
    },
    /** Transfers it into `group`, and waits until it says it is there. */
    transferTo: async (group: string): Promise<void> => {
      await choose(group)
      await page.until(owner, (said) => said === `In ${group}`)
    },
    /** Tries to transfer it into `group`, and returns what it was refused for. */
    transferRefused: async (group: string): Promise<string | null> => {
      await choose(group)
      await page.waitFor(`${prefix}-error`)
      return await page.text(`${prefix}-error`)
    },
  }
}
