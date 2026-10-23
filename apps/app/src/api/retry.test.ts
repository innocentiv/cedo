import { describe, expect, test } from 'bun:test'
import { ApiError, NetworkError } from './errors.ts'
import { MAX_SENDS, newIdempotencyKey, sendAgain } from './retry.ts'

/**
 * When a set sent on a weak signal is sent again. Only ever under its idempotency key, which makes
 * the repeat safe: the server answers a key it has stored with the stored set.
 */
describe('a set is sent again', () => {
  test('when nothing answered, or the server failed', () => {
    expect(sendAgain(1, new NetworkError('/sessions/s/logs'))).toBe(true)
    expect(sendAgain(1, new ApiError(502, 'internal', 'Bad gateway', null))).toBe(true)
    expect(sendAgain(1, new ApiError(500, 'internal', 'Boom', null))).toBe(true)
  })

  /** A refusal is an answer: sending it again gets the same one. The set is dropped, and said. */
  test('never when the server refused it', () => {
    expect(sendAgain(1, new ApiError(409, 'conflict', 'Finished', null))).toBe(false)
    expect(sendAgain(1, new ApiError(404, 'not_found', 'No such entry', null))).toBe(false)
    expect(sendAgain(1, new ApiError(422, 'validation_failed', 'Bad', null))).toBe(false)
    expect(sendAgain(1, new Error('a bug'))).toBe(false)
  })

  /** A server failing every time must not hold the session's queue, and its finish, forever. */
  test(`at most ${MAX_SENDS} times in all`, () => {
    const lost = new NetworkError('/sessions/s/logs')
    expect(sendAgain(MAX_SENDS - 1, lost)).toBe(true)
    expect(sendAgain(MAX_SENDS, lost)).toBe(false)
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
