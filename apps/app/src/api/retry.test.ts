import { describe, expect, test } from 'bun:test'
import { ApiError, NetworkError } from './errors.ts'
import { newIdempotencyKey, retryDelayMs, retryable } from './retry.ts'

/**
 * When a set sent on a weak signal is sent again. Only ever under its idempotency key, which makes
 * the repeat safe: the server answers a key it has stored with the stored set.
 */
describe('a set is sent again', () => {
  test('when nothing answered, or the server failed', () => {
    expect(retryable(new NetworkError('/sessions/s/logs'))).toBe(true)
    expect(retryable(new ApiError(502, 'internal', 'Bad gateway', null))).toBe(true)
    expect(retryable(new ApiError(500, 'internal', 'Boom', null))).toBe(true)
  })

  /** A refusal is an answer: sending it again gets the same one. The set is dropped, and said. */
  test('never when the server refused it', () => {
    expect(retryable(new ApiError(409, 'conflict', 'Finished', null))).toBe(false)
    expect(retryable(new ApiError(404, 'not_found', 'No such entry', null))).toBe(false)
    expect(retryable(new ApiError(422, 'validation_failed', 'Bad', null))).toBe(false)
    expect(retryable(new Error('a bug'))).toBe(false)
  })

  test('after a wait that grows, to half a minute at most', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((attempt) => retryDelayMs(attempt))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
    ])
  })
})

describe('an idempotency key', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

  test('is a version 4 UUID, as the API accepts', () => {
    expect(newIdempotencyKey()).toMatch(UUID_V4)
  })

  /** `crypto.randomUUID` exists only on HTTPS or localhost; the app also runs over plain HTTP. */
  test('is made from random bytes alone, so it works where randomUUID does not', () => {
    const zeros = (bytes: Uint8Array) => bytes.fill(0)
    expect(newIdempotencyKey(zeros)).toBe('00000000-0000-4000-8000-000000000000')
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey())
  })
})
