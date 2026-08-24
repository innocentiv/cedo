import { join } from 'node:path'
import { sharedApi, withApp } from './harness.ts'

/**
 * `bun run shot /exercises [--tablet]` — the frontend inner loop.
 *
 * Renders one route against a real API, writes a PNG to `.artifacts/`, and prints every console
 * message. The AI edits a screen, runs this, reads the picture and reads the errors.
 * See docs/08-frontend.md.
 */

const args = Bun.argv.slice(2)
const tablet = args.includes('--tablet')
const route = args.find((a) => !a.startsWith('--')) ?? '/'
const asUser = args.includes('--anonymous') ? null : 'shot'

const SHOT_USER = 'shot'
const SHOT_PASSWORD = 'shot-password'

const name = `shot${route.replaceAll('/', '-') || '-root'}${tablet ? '-tablet' : ''}`

const captured: string[] = []
try {
  await withApp(
    name,
    async (page) => {
      if (asUser !== null) await signIn(page)
      await page.goto(route)
      captured.push(...page.errors)
    },
    { layout: tablet ? 'tablet' : 'phone' },
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
}

console.log(`\nRendered ${route} at ${tablet ? 'tablet' : 'phone'} width.`)
console.log(`Screenshot: ${join('.artifacts', `${name}.png`)}`)
console.log(
  captured.length === 0 ? 'No console errors.' : `Console errors:\n  ${captured.join('\n  ')}`,
)

const api = await sharedApi()
api.stop()
process.exit(0)

/**
 * Registers a throwaway account so the route renders with data. Re-running reuses it: registration
 * conflicts are expected and the sign-in that follows is the real path anyway.
 */
async function signIn(page: Parameters<Parameters<typeof withApp>[1]>[0]): Promise<void> {
  // Registration first; on a reused database the account already exists and this fails, which is
  // the ordinary case, so sign-in is always attempted afterwards rather than only on a fresh run.
  await page.goto('/register')
  if (await page.exists('register-username')) {
    await page.fill('register-username', SHOT_USER)
    await page.fill('register-display-name', 'Shot User')
    await page.fill('register-password', SHOT_PASSWORD)
    await page.click('[data-testid="register-submit"]')
  }
  if (await page.exists('today-screen')) return

  await page.goto('/login')
  await page.waitFor('login-username')
  await page.fill('login-username', SHOT_USER)
  await page.fill('login-password', SHOT_PASSWORD)
  await page.click('[data-testid="login-submit"]')
  await page.waitFor('today-screen')
}
