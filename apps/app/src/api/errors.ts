import type { z } from 'zod'
import type { ErrorCode, ErrorDetail } from '@cedo/contract'

/**
 * The two ways a request can fail that a screen may need to tell apart. Thrown by `transport.ts`,
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
 * The API answered with something the contract does not describe.
 *
 * Deliberately loud. This is the failure Eden Treaty cannot report: compile-time types say nothing
 * about what a running server returns. It lands in `console.error`, which fails the WebView run and
 * hands the exact JSON path to whoever is iterating. See docs/10-testing.md.
 */
export class ContractDriftError extends Error {
  readonly path: string
  readonly issues: readonly z.core.$ZodIssue[]

  constructor(path: string, error: z.ZodError) {
    const where = error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    super(`The API response for ${path} does not match the contract — ${where}`)
    this.name = 'ContractDriftError'
    this.path = path
    this.issues = error.issues
  }
}
