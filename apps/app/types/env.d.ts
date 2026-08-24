/**
 * Declares the app's public runtime configuration as real properties.
 *
 * Deliberately NOT `expo-env.d.ts`: that filename belongs to the Expo CLI, which regenerates it and
 * rewrites `tsconfig.json`'s `include` on every `expo start` / `expo export`. A declaration put
 * there is deleted the next time either runs, and the app stops typechecking with an error about
 * index signatures that points nowhere near the cause.
 *
 * This exists so `process.env.EXPO_PUBLIC_API_URL` can be written with DOT access. Expo's Babel
 * plugin substitutes `EXPO_PUBLIC_*` only for static member access — `process.env['NAME']` is left
 * alone and evaluates to undefined at runtime, so a native build threw "EXPO_PUBLIC_API_URL must be
 * set" no matter what was set. Verified by grepping the bundle: with bracket access neither the
 * value nor the variable name appears in it.
 *
 * The repo sets `noPropertyAccessFromIndexSignature`, which forbids dot access on an index
 * signature; a declared property is not an index signature, so this satisfies both.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    /** Where the API lives. Unset on web, where Caddy proxies `/api` on the same origin. */
    readonly EXPO_PUBLIC_API_URL?: string
  }
}
