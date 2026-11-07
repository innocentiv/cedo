import type { Page } from '../harness.ts'
import { nav } from './nav.ts'

/**
 * Signing up and in, through the screens. Each driver in this folder owns its screen's test ids and
 * waits, so a journey says what a person does and asserts what they see — and a renamed id breaks
 * one line here, not every journey that passes through the screen. See docs/10-testing.md.
 */

const PASSWORD = 'e2e-password'
let seq = 0

/** A name no other run has used: the API, and so its usernames, are shared by the whole suite. */
export const unique = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(seq += 1)}`

export const auth = (page: Page) => ({
  /** Registers through the form, and lands on Today signed in. */
  register: async (username: string): Promise<void> => {
    await page.goto('/register')
    await page.waitFor('register-username')
    await page.fill('register-username', username)
    await page.fill('register-display-name', username)
    await page.fill('register-password', PASSWORD)
    await page.click('[data-testid="register-submit"]')
    await nav(page).onToday()
  },

  /** Signs in through the form, and lands on Today signed in. */
  signIn: async (username: string, password: string): Promise<void> => {
    await page.goto('/login')
    await page.waitFor('login-username')
    await page.fill('login-username', username)
    await page.fill('login-password', password)
    await page.click('[data-testid="login-submit"]')
    await nav(page).onToday()
  },

  /** Waits for the login screen — where a forgotten credential sends you. */
  onLoginScreen: async (): Promise<void> => {
    await page.waitFor('login-screen')
  },

  /** Whether the login screen offers to create an account, as it does until told sign-up is closed. */
  offersSignUp: async (): Promise<boolean> => {
    await page.waitFor('login-screen')
    return await page.exists('to-register')
  },

  /** Waits for the login screen to stop offering an account: the instance has said it is closed. */
  stopsOfferingSignUp: async (): Promise<void> => {
    await page.waitFor('login-screen')
    await page.until(
      async () => await page.exists('to-register'),
      (offered) => !offered,
    )
  },

  /** Waits for "can't reach your server" — signed in, with nothing answering. */
  onUnreachable: async (): Promise<void> => {
    await page.waitFor('unreachable-screen')
  },
})
