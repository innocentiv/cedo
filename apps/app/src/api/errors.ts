import type { z } from 'zod'
import type { ErrorCode, ErrorDetail } from '@cedo/contract'

/**
 * The ways a request can fail that a screen may need to tell apart. Thrown by `transport.ts`,
 * kept apart from it because they are a contract of their own: `useSubmit` and every error boundary
 * branch on them.
 */

/** The API answered, and said no. Carries the contract's own error code so screens can branch. */
export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  /** Field-level detail, so a form can highlight the offending input. */
  readonly details: readonly ErrorDetail[] | null

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details: readonly ErrorDetail[] | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Nothing answered: no signal, or no server at that address. `fetch`'s own rejection is a bare
 * TypeError, which a bug throws too — so the transport says this instead, and a lost signal can be
 * told from a broken client (`session.ts` keeps the session through one, and says the other).
 */
export class NetworkError extends Error {
  constructor(path: string, options?: ErrorOptions) {
    super(`${path}: no answer from the server`, options)
    this.name = 'NetworkError'
  }
}

/**
 * The API answered with something the contract does not describe.
 *
 * Deliberately loud. This is the failure Eden Treaty cannot report: compile-time types say nothing
 * about what a running server returns. It lands in `console.error`, which fails the WebView run and
 * hands the exact JSON path to whoever is iterating. See docs/10-testing.md.
 *
 * It is also what a person reads when a native app and its server are not one version (#78): one
 * of them is older, and the message says to update it before the detail. Thrown, it cannot know
 * the server's version; the native app's Settings names both.
 */
export class ContractDriftError extends Error {
  readonly path: string
  readonly issues: readonly z.core.$ZodIssue[]

  constructor(path: string, error: z.ZodError) {
    const where = error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    super(
      `This app and your server do not match: update the older one. The API response for ${path} does not match the contract — ${where}`,
    )
    this.name = 'ContractDriftError'
    this.path = path
    this.issues = error.issues
  }
}
