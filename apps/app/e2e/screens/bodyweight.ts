import type { Page } from '../harness.ts'
import { linesOf } from './lines.ts'
import { nav } from './nav.ts'

/** Where a bodyweight is: your own on Progress, or an athlete's on their page. */
type Where = 'progress' | 'athlete'

/**
 * Bodyweight (#42): the latest weigh-in and its change over the period, today's taken, and the
 * period's listed — on Progress and on an athlete's page alike, newest first. And the year someone
 * was born, which they say in Settings.
 */
export const bodyweight = (page: Page) => {
  const card = (where: Where) => `${where}-bodyweight`
  const row = (where: Where, at: number) => `${card(where)}-weigh-in-${String(at)}`
  return {
    /** The card as it reads, a line at a time: its label, the latest and its change, then the list. */
    read: async (where: Where): Promise<string[]> => {
      await page.waitFor(card(where))
      return (await linesOf(page, card(where))).filter(
        (line) => !['Bodyweight', 'Today, kg', 'Today, lb', 'Save', 'Remove'].includes(line),
      )
    },
    /** Today's weight, typed key by key in the reader's unit, and saved. */
    take: async (where: Where, weight: string): Promise<void> => {
      await page.click(`[data-testid="${card(where)}-today-weight"]`)
      await page.type(weight)
      await page.click(`[data-testid="${card(where)}-today-save"]`)
      await page.until(
        async () => await page.value(`${card(where)}-today-weight`),
        (left) => left === '',
      )
    },
    /** Whether the weigh-in `at` offers Remove — only to whoever may. */
    removable: async (where: Where, at: number): Promise<boolean> =>
      await page.shown(`${row(where, at)}-remove`),
    /** Removes the weigh-in `at`, asked twice. */
    remove: async (where: Where, at: number): Promise<void> => {
      await page.click(`[data-testid="${row(where, at)}-remove"]`)
      await page.click(`[data-testid="${row(where, at)}-remove-confirm"]`)
    },
    /** Says the year they were born in Settings, typed key by key, and waits until it is saved. */
    sayBirthYear: async (year: string): Promise<void> => {
      await nav(page).tab('settings')
      await page.waitFor('settings-screen')
      await page.click('[data-testid="birth-year"]')
      await page.type(year)
      await page.click('[data-testid="birth-year-save"]')
      const mine = await page.client()
      await page.until(
        async () => (await mine.auth.me()).user.birthYear,
        (saved) => saved === Number(year),
      )
    },
  }
}
