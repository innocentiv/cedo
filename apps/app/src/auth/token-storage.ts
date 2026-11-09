import { Platform } from 'react-native'
import type * as SecureStore from 'expo-secure-store'
import type { AlertKindStore } from '../lib/rest-alert.ts'
import type { ServerStore } from './server.ts'
import type { TokenStore } from './session.ts'

/**
 * Where the session token lives — and, on native, which server issued it (#78): the OS keychain on
 * native, `localStorage` on web.
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

const isWeb = Platform.OS === 'web'

/**
 * Imported lazily so the web bundle never evaluates the native module. Every web access is also
 * guarded: Safari in private mode throws on `localStorage` rather than returning null, and an app
 * that cannot remember a token should still run.
 */
async function secureStore(): Promise<typeof SecureStore> {
  return await import('expo-secure-store')
}

/** One string kept between launches, under `key`. */
function kept(key: string): TokenStore {
  return {
    read: async () => {
      if (!isWeb) return await (await secureStore()).getItemAsync(key)
      try {
        return globalThis.localStorage?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    write: async (value) => {
      if (!isWeb) {
        await (await secureStore()).setItemAsync(key, value)
        return
      }
      try {
        globalThis.localStorage?.setItem(key, value)
      } catch {
        // A session that does not survive a reload is worse than one that does, not worse than none.
      }
    },
    clear: async () => {
      if (!isWeb) {
        await (await secureStore()).deleteItemAsync(key)
        return
      }
      try {
        globalThis.localStorage?.removeItem(key)
      } catch {
        // If it could not be written it cannot have been stored.
      }
    },
  }
}

/** The keychain, as the session reads and writes it. */
export const tokenStore: TokenStore = kept('cedo.session')

/** The server the token was issued by, as the native app keeps it (`server.ts`). */
export const serverStore: ServerStore = kept('cedo.server')

/** How this phone tells a rest's end with the app closed (#39, `src/lib/rest-alert.ts`). */
export const restAlertStore: AlertKindStore = kept('cedo.rest-alert')
