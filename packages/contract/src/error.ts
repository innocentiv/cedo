import { z } from 'zod'

/**
 * One error envelope for the whole API. Services throw typed domain errors; a single `onError`
 * handler maps them here. See docs/02-conventions.md.
 *
 * Codes are generic rather than per-resource (`not_found`, not `exercise_not_found`) so a client
 * can switch exhaustively over a fixed set. The resource is named in `message`.
 */
export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'not_found',
  'conflict',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'sign_up_closed',
  'internal',
] as const

export const ErrorCode = z.enum(ERROR_CODES)
export type ErrorCode = z.output<typeof ErrorCode>

/** Field-level detail, so a form can highlight the offending input. */
export const ErrorDetail = z.object({
  path: z.string(),
  message: z.string(),
})
export type ErrorDetail = z.output<typeof ErrorDetail>

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.array(ErrorDetail).nullable(),
  }),
})
export type ApiError = z.output<typeof ApiError>

/**
 * There is deliberately no `forbidden`. A resource the caller may not see returns `not_found`,
 * because a 403 confirms the resource exists and leaks that fact to a stranger.
 * See docs/02-conventions.md.
 *
 * `sign_up_closed` is the one 403. It refuses a new account (#71), and whether an instance takes
 * accounts is already public (`GET /instance`), so saying so leaks nothing.
 */
export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, number>> = {
  validation_failed: 422,
  unauthenticated: 401,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  sign_up_closed: 403,
  internal: 500,
}
