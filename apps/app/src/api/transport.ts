import { ApiError as ApiErrorSchema } from '@cedo/contract'
import type { z } from 'zod'
import { ApiError, ContractDriftError, NetworkError } from './errors.ts'

/**
 * One request to the API, its response parsed with the SAME contract schema the API validated it
 * against — so a drift between the two halves is a loud failure with a JSON path, not a screen that
 * renders `undefined`.
 *
 * Plain `fetch` and the contract, nothing else: no `react-native`, no module-level session. The app
 * builds one from its own session (`http.ts`), and the e2e harness builds one per user it signs up,
 * from the test process — which is why this half cannot know where the token lives.
 */

export type QueryInput = Record<string, string | number | boolean | undefined>

export interface RequestOptions {
  readonly query?: QueryInput
  readonly body?: unknown
  /** Multipart uploads set their own content type, including a boundary Request generates. */
  readonly form?: FormData
  /** Request headers of its own — an `Idempotency-Key`, on a write that may be retried. */
  readonly headers?: Readonly<Record<string, string>>
}

export type SendRequest = <S extends z.ZodType>(
  method: string,
  path: string,
  schema: S,
  options?: RequestOptions,
) => Promise<z.output<S>>

export interface TransportConfig {
  /** Where the API is. A function, so the app can resolve it lazily. */
  readonly baseUrl: () => string
  /** The credential to send now, if any. */
  readonly token: () => string | null
  /**
   * The API rejected the credential that was sent — handed over, so whoever holds the session can
   * tell a late 401 for a previous person's token from one for its own.
   */
  readonly onUnauthenticated?: (sentToken: string) => void
}

function queryString(query: QueryInput | undefined): string {
  if (query === undefined) return ''
  const pairs = Object.entries(query).filter(([, v]) => v !== undefined)
  if (pairs.length === 0) return ''
  return `?${new URLSearchParams(pairs.map(([k, v]) => [k, String(v)])).toString()}`
}

async function toApiError(response: Response, path: string): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null)
  const parsed = ApiErrorSchema.safeParse(body)
  if (parsed.success) {
    return new ApiError(
      response.status,
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.details,
    )
  }
  // A proxy or a crash can answer with something that is not the envelope at all.
  return new ApiError(response.status, 'internal', `${path} failed with ${response.status}`)
}

export function transport(config: TransportConfig): SendRequest {
  return async (method, path, schema, options = {}) => {
    const headers: Record<string, string> = { ...options.headers }
    const sent = config.token()
    if (sent !== null) headers['authorization'] = `Bearer ${sent}`
    if (options.body !== undefined) headers['content-type'] = 'application/json'

    const body = options.form ?? (options.body === undefined ? null : JSON.stringify(options.body))
    const response = await fetch(`${config.baseUrl()}${path}${queryString(options.query)}`, {
      method,
      headers,
      ...(body === null ? {} : { body }),
    }).catch((error: unknown) => {
      throw new NetworkError(path, { cause: error })
    })

    if (!response.ok) {
      const failure = await toApiError(response, path)
      // Only when a credential was actually sent: a 401 from the login route means "wrong
      // password", which the form must show rather than the shell reacting to.
      if (failure.code === 'unauthenticated' && sent !== null) config.onUnauthenticated?.(sent)
      throw failure
    }

    const text = await response.text()
    const payload: unknown = text === '' ? null : JSON.parse(text)

    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new ContractDriftError(path, parsed.error)
    return parsed.data
  }
}
