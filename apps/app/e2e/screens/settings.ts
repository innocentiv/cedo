import type { SignUp } from '@cedo/contract'
import type { Page } from '../harness.ts'
import { nav } from './nav.ts'

/** Settings: the weight unit, access tokens, and the curator's sign-up switch. */

export const settings = (page: Page) => ({
  /** Whether Settings offers the sign-up switch (#71), which only the curator is shown. */
  offersSignUpSwitch: async (): Promise<boolean> => {
    await page.goto('/settings')
    await page.waitFor('settings-screen')
    return await page.exists('settings-sign-up')
  },
  /** Opens or closes sign-up from Settings, and waits until the instance says so. */
  setSignUp: async (signUp: SignUp): Promise<void> => {
    await page.goto('/settings')
    await page.waitFor(`sign-up-${signUp}`)
    await page.click(`[data-testid="sign-up-${signUp}"]`)
    const mine = await page.client()
    await page.until(
      async () => (await mine.instance.get()).signUp,
      (saved) => saved === signUp,
    )
  },
  /** Signs out from Settings, and lands on the login screen. */
  signOut: async (): Promise<void> => {
    await nav(page).tab('settings')
    await page.waitFor('settings-screen')
    await page.click('[data-testid="sign-out"]')
    await page.waitFor('login-screen')
  },
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
  /**
   * From the Settings tab to "Connect your AI", creates the token there, and returns what the
   * screen shows to paste — with the page's own origin, which the address must be under.
   */
  connectAi: async (): Promise<{
    readonly origin: string
    readonly address: string | null
    readonly claudeCode: string | null
    readonly json: string | null
  }> => {
    await nav(page).tab('settings')
    await page.waitFor('settings-screen')
    await page.click('[data-testid="connect-ai"]')
    await page.waitFor('connect-screen')
    await page.click('[data-testid="connect-create-token"]')
    await page.waitFor('connect-token-created')
    return {
      origin: String(await page.evaluate('location.origin')),
      address: await page.text('mcp-address'),
      claudeCode: await page.text('snippet-claude-code'),
      json: await page.text('snippet-json'),
    }
  },
  /** From the Settings tab to the tokens screen, as someone would. */
  openTokens: async (): Promise<void> => {
    await nav(page).tab('settings')
    await page.waitFor('settings-screen')
    await page.click('[data-testid="manage-tokens"]')
    await page.waitFor('tokens-screen')
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
