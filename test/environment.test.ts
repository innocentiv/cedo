import { describe, expect, test } from 'bun:test'

/**
 * The architecture depends on APIs introduced in Bun 1.4. If these are missing, the failure
 * modes are confusing and far from their cause, so assert them once, loudly, up front.
 *
 * See docs/10-testing.md and docs/adr/0017-webview-for-ui-verification.md
 */
describe('runtime prerequisites', () => {
  test('Bun is at least 1.4.0', () => {
    const [major = 0, minor = 0] = Bun.version.split('.').map(Number)
    expect(major > 1 || (major === 1 && minor >= 4)).toBe(true)
  })

  test('Bun.WebView exists — the entire UI verification strategy depends on it', () => {
    expect(typeof Bun.WebView).toBe('function')
  })

  test('Bun.Image exists — media thumbnails depend on it instead of sharp', () => {
    expect(typeof Bun.Image).toBe('function')
  })

  test('Bun.password uses argon2id by default', async () => {
    const hash = await Bun.password.hash('correct horse battery staple')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await Bun.password.verify('correct horse battery staple', hash)).toBe(true)
    expect(await Bun.password.verify('wrong', hash)).toBe(false)
  })
})
