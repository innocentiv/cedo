import { Platform } from 'react-native'
import { ApiError as ApiErrorSchema } from '@cedo/contract'
import { ApiError, ContractDriftError } from './errors.ts'
import type { z } from 'zod'

/**
 * The whole client. It depends on `@cedo/contract` and nothing else from this repo — never on
 * `apps/api`, not even for a type. See docs/adr/0015-no-eden-treaty.md.
 *
 * Every response is parsed with the SAME schema the API validated it against, so a drift between
 * the two halves is a loud runtime failure with a JSON path, not a screen that renders `undefined`.
 */

/**
 * Same-origin on web: Caddy proxies `/api` to the API container, so nothing about the deployment
 * host is baked into the bundle and the same image works on any NAS at any hostname.
 *
 * Native has no such proxy and must be told where the server is. `EXPO_PUBLIC_` is Expo's inlining
 * prefix, so this is resolved at bundle time.
 */
function resolveBaseUrl(): string {
  const configured = process.env['EXPO_PUBLIC_API_URL']
  if (configured !== undefined && configured !== '') return configured.replace(/\/$/u, '')
  if (Platform.OS === 'web') return '/api'
  throw new Error(
    'EXPO_PUBLIC_API_URL must be set for native builds — there is no same-origin proxy outside the browser.',
  )
}

let baseUrl: string | undefined

/** Lazy so importing this module on native without the variable set does not crash at load. */
function base(): string {
  baseUrl ??= resolveBaseUrl()
  return baseUrl
}

export type QueryInput = Record<string, string | number | boolean | undefined>

function queryString(query: QueryInput | undefined): string {
  if (query === undefined) return ''
  const pairs = Object.entries(query).filter(([, v]) => v !== undefined)
  if (pairs.length === 0) return ''
  return `?${new URLSearchParams(pairs.map(([k, v]) => [k, String(v)])).toString()}`
}

/** Set by the auth provider. A module-level holder so every call site does not thread it through. */
let bearer: string | null = null

export function setAuthToken(token: string | null): void {
  bearer = token
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

export interface RequestOptions {
  readonly query?: QueryInput
  readonly body?: unknown
  /** Multipart uploads set their own content type, including a boundary Request generates. */
  readonly form?: FormData
}

export async function request<S extends z.ZodType>(
  method: string,
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const headers: Record<string, string> = {}
  if (bearer !== null) headers['authorization'] = `Bearer ${bearer}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  const body = options.form ?? (options.body === undefined ? null : JSON.stringify(options.body))
  const response = await fetch(`${base()}${path}${queryString(options.query)}`, {
    method,
    headers,
    body,
  })

  if (!response.ok) throw await toApiError(response, path)

  const text = await response.text()
  const payload: unknown = text === '' ? null : JSON.parse(text)

  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new ContractDriftError(path, parsed.error)
  return parsed.data
}

export const GET = async <S extends z.ZodType>(
  path: string,
  schema: S,
  query?: QueryInput,
): Promise<z.output<S>> => await request('GET', path, schema, { ...(query && { query }) })

export const POST = async <S extends z.ZodType>(
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.output<S>> => await request('POST', path, schema, { body })

export const PATCH = async <S extends z.ZodType>(
  path: string,
  schema: S,
  body: unknown,
): Promise<z.output<S>> => await request('PATCH', path, schema, { body })

export const PUT = async <S extends z.ZodType>(
  path: string,
  schema: S,
  body: unknown,
): Promise<z.output<S>> => await request('PUT', path, schema, { body })

export const DELETE = async <S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> =>
  await request('DELETE', path, schema)

export { ApiError, ContractDriftError } from './errors.ts'
