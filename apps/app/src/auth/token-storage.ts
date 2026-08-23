import { Platform } from 'react-native'
import type * as SecureStore from 'expo-secure-store'

/**
 * Where the session token lives: the OS keychain on native, `localStorage` on web.
 *
 * **Branching on `Platform.OS` rather than a `.web.ts` file split, deliberately.** Metro picks
 * platform variants by extension, and this repo imports with explicit `.ts` extensions everywhere —
 * which resolves the literal file and silently skips the variant. The app then called
 * `expo-secure-store` in a browser and every sign-in died on
 * `getValueWithKeyAsync is not a function`. One file that branches in the open cannot fail that
 * way. See docs/08-frontend.md.
 *
 * **Documented tradeoff on web.** A token in `localStorage` is reachable by any script that runs on
 * the page, so an XSS becomes a session theft. That is accepted for a self-hosted application with
 * no third-party scripts and no advertising. Moving to an httpOnly cookie would touch this file and
 * the login handler, and nothing else.
 */

const KEY = 'cedo.session'

const isWeb = Platform.OS === 'web'

/**
 * Imported lazily so the web bundle never evaluates the native module. Every web access is also
 * guarded: Safari in private mode throws on `localStorage` rather than returning null, and an app
 * that cannot remember a token should still run.
 */
async function secureStore(): Promise<typeof SecureStore> {
  return await import('expo-secure-store')
}

export async function readToken(): Promise<string | null> {
  if (!isWeb) return await (await secureStore()).getItemAsync(KEY)
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

export async function writeToken(token: string): Promise<void> {
  if (!isWeb) {
    await (await secureStore()).setItemAsync(KEY, token)
    return
  }
  try {
    globalThis.localStorage?.setItem(KEY, token)
  } catch {
    // A session that does not survive a reload is worse than one that does, not worse than none.
  }
}

export async function clearToken(): Promise<void> {
  if (!isWeb) {
    await (await secureStore()).deleteItemAsync(KEY)
    return
  }
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    // If it could not be written it cannot have been stored.
  }
}
