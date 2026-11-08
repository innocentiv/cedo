import { z } from 'zod'

/**
 * The instance itself (#71): what any client may ask before signing in — that the server is cedo,
 * which version, and whether it takes new accounts. A native app's server-address screen (#10)
 * reads the same answer to recognise a cedo server.
 */

/**
 * How sign-up is stored. `first` is a fresh instance: the next account becomes its curator, and
 * sign-up closes behind it. `open` and `closed` are the curator's switch. See ADR-0029.
 */
export const SIGN_UP_STATES = ['first', 'open', 'closed'] as const
export type SignUpState = (typeof SIGN_UP_STATES)[number]

/** How sign-up is shown: `first` takes an account, so to a client it is open. */
export const SignUp = z.enum(SIGN_UP_STATES).exclude(['first'])
export type SignUp = z.output<typeof SignUp>

export function signUpOf(state: SignUpState): SignUp {
  return state === 'closed' ? 'closed' : 'open'
}

export const PRODUCT = 'cedo'

/**
 * The version, of the server and of the app built beside it: what `/instance`, `/admin/status`
 * and the MCP handshake report, and what a native app compares with its server's (#78).
 *
 * One constant, in the one place both read, because a stranger reporting a problem gives whichever
 * number their client shows, and sources that could drift would make that number useless.
 */
export const VERSION = '0.1.0'

/** The version of a checkout no release was cut from: nothing is published for it (#79). */
export const UNRELEASED = '0.0.0'

/** `GET /instance`, signed in or not. */
export const Instance = z.object({
  product: z.literal(PRODUCT),
  version: z.string(),
  signUp: SignUp,
})
export type Instance = z.output<typeof Instance>

/** `PATCH /instance`: the curator opens sign-up for testers, then closes it again. */
export const InstancePatch = z.strictObject({ signUp: SignUp })
export type InstancePatch = z.output<typeof InstancePatch>
