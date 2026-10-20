import type { Page } from '../harness.ts'
import { nav } from './nav.ts'

/** Settings: the weight unit, and access tokens. */

export const settings = (page: Page) => ({
  /** Chooses a unit from the Settings tab, and waits until the account has saved it. */
  chooseUnit: async (unit: 'kg' | 'lb'): Promise<void> => {
    await nav(page).tab('settings')
    await page.waitFor('settings-screen')
    await page.click(`[data-testid="weight-unit-${unit}"]`)
    const mine = await page.client()
    await page.until(
      async () => (await mine.auth.me()).user.weightUnit,
      (saved) => saved === unit,
    )
  },
  /** Creates a token; returns the secret, shown this once. */
  createToken: async (name: string): Promise<string | null> => {
    await page.goto('/settings/tokens')
    await page.waitFor('tokens-screen')
    await page.fill('token-name', name)
    await page.click('[data-testid="create-token"]')
    await page.waitFor('token-secret')
    return await page.text('token-secret')
  },
  tokenListText: async (): Promise<string> => {
    await page.waitFor('token-list')
    return (await page.text('token-list')) ?? ''
  },
  /** Revokes the token named `name`, asked twice, and waits until it is listed no more. */
  revokeToken: async (name: string): Promise<void> => {
    const row = await page.evaluate(
      `[...document.querySelectorAll('[data-testid^="token-row-"]')].find((e) => e.innerText.split('\\n')[0].trim() === ${JSON.stringify(name)})?.dataset.testid ?? null`,
    )
    if (typeof row !== 'string') throw new Error(`No token named ${name} is listed`)
    const revoke = row.replace('token-row-', 'token-revoke-')
    await page.click(`[data-testid="${revoke}"]`)
    await page.click(`[data-testid="${revoke}-confirm"]`)
    await page.until(
      async () => await page.exists(row),
      (listed) => !listed,
    )
  },
})
