import { HTTP_STATUS_BY_ERROR_CODE, type ApiError, type ErrorCode } from '@cedo/contract'

/**
 * Services throw these; one `onError` handler in the composition root turns them into the wire
 * envelope. Route handlers never build an error response themselves.
 * See docs/02-conventions.md.
 */
export class DomainError extends Error {
  readonly code: ErrorCode
  readonly details: ApiError['error']['details']

  constructor(code: ErrorCode, message: string, details: ApiError['error']['details'] = null) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.details = details
  }
}

/**
 * Used for both "does not exist" and "you may not see it". A 403 would confirm the resource exists
 * and leak that fact to a stranger, so there is deliberately no forbidden case.
 */
export const notFound = (what: string): DomainError =>
  new DomainError('not_found', `No such ${what}`)

export const conflict = (message: string): DomainError => new DomainError('conflict', message)

export const unauthenticated = (message = 'Authentication required'): DomainError =>
  new DomainError('unauthenticated', message)

export const invalid = (
  message: string,
  details: ApiError['error']['details'] = null,
): DomainError => new DomainError('validation_failed', message, details)

export function toApiError(error: DomainError): { status: number; body: ApiError } {
  return {
    status: HTTP_STATUS_BY_ERROR_CODE[error.code],
    body: { error: { code: error.code, message: error.message, details: error.details } },
  }
}
