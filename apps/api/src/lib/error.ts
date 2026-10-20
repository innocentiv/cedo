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

/**
 * 23001 is what ON DELETE RESTRICT raises; 23503 is NO ACTION, or a dangling insert. Matching only
 * the "foreign key" one, 23503, left the actual RESTRICT refusal a 500.
 */
const FOREIGN_KEY_REFUSALS = new Set(['23001', '23503'])

const sqlState = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e ? e.code : null

/**
 * A write Postgres refused over a foreign key: deleting a row something still references, or
 * inserting one that references a row that is gone. Drizzle wraps driver errors, so the SQLSTATE
 * may sit on the error or on its `cause`.
 */
export function isForeignKeyRefusal(error: unknown): boolean {
  const cause = typeof error === 'object' && error !== null && 'cause' in error ? error.cause : null
  return [sqlState(error), sqlState(cause)].some(
    (code) => typeof code === 'string' && FOREIGN_KEY_REFUSALS.has(code),
  )
}

/**
 * A write Postgres refused over the unique index `index` — named, so a violation of another is not
 * mistaken for it. On the error or its `cause`, as with `isForeignKeyRefusal`.
 */
export function isUniqueViolation(error: unknown, index: string): boolean {
  const cause = typeof error === 'object' && error !== null && 'cause' in error ? error.cause : null
  return [error, cause].some(
    (e) =>
      sqlState(e) === '23505' &&
      typeof e === 'object' &&
      e !== null &&
      'constraint_name' in e &&
      e.constraint_name === index,
  )
}

export function toApiError(error: DomainError): { status: number; body: ApiError } {
  return {
    status: HTTP_STATUS_BY_ERROR_CODE[error.code],
    body: { error: { code: error.code, message: error.message, details: error.details } },
  }
}

/**
 * Exhaustiveness guard for a union that arrives from outside the type system — a query parameter,
 * a JSONB column, a row written by an older version. Throwing beats silently taking a wrong branch.
 */
export function unreachable(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`)
}
