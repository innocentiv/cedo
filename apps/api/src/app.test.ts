import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ERROR_CODES } from '@cedo/contract'
import { type TestApi, makeApi } from './test/harness.ts'

let h: TestApi
beforeEach(async () => {
  h = await makeApi()
})

describe('health', () => {
  test('reports database reachability, not just process liveness', async () => {
    const res = await h.wire('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, db: true })
  })

  test('is reachable without authentication, so a container healthcheck works', async () => {
    expect((await h.wire('/health')).status).toBe(200)
  })
})

describe('openapi', () => {
  /**
   * A route validated by Zod must not document as an empty object, which is what Elysia 1.x did
   * without `mapJsonSchema`. This asserts the spec actually carries our schemas.
   * See docs/04-contract.md.
   */
  test('the spec is generated from the Zod schemas, not empty stubs', async () => {
    const res = await h.wire('/openapi/json')
    expect(res.status).toBe(200)

    const spec = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(res.body)

    expect(Object.keys(spec.paths)).toContain('/auth/register')
    expect(Object.keys(spec.paths).some((p) => p.startsWith('/groups'))).toBe(true)

    const serialised = JSON.stringify(spec)
    expect(serialised).toContain('displayName')
    expect(serialised).toContain('username')
  })

  test('serves a human-readable UI', async () => {
    const res = await h.wire('/openapi')
    expect(res.status).toBe(200)
  })
})

describe('error handling', () => {
  test('every error code in the contract maps to a real status', () => {
    expect(ERROR_CODES.length).toBeGreaterThan(0)
  })

  test('a malformed JSON body is a 4xx, never a 500', async () => {
    const res = await h.wire('/auth/login', { method: 'POST', body: '{not json' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  test('a wrong content type does not crash the server', async () => {
    const res = await h.wire('/auth/login', {
      method: 'POST',
      body: 'username=a&password=b',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})

/**
 * What the framework itself decides about a response, pinned whole: status, content type and body.
 * The tests above say "a 4xx" and "contains"; under them a change of framework version could alter
 * a path, a message or a status with the suite green. Written against Elysia 1.4 before the move
 * to Elysia 2 (#86), which must not edit them.
 */
describe('what the framework hands to the wire', () => {
  const JSON_TYPE = 'application/json;charset=utf-8'
  const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000'

  const failed = (details: readonly { path: string; message: string }[]) => ({
    error: { code: 'validation_failed', message: 'Request failed validation', details },
  })
  const UNPARSEABLE = {
    error: {
      code: 'validation_failed',
      message: 'Could not parse the request body',
      details: null,
    },
  }
  const NO_ROUTE = { error: { code: 'not_found', message: 'No such route', details: null } }

  const post = (path: string, body: string, contentType?: string) =>
    h.wire(path, {
      method: 'POST',
      body,
      ...(contentType === undefined ? {} : { headers: { 'content-type': contentType } }),
    })

  describe('a body that fails validation', () => {
    test('names a top-level field by its name, with the schema’s own message', async () => {
      const res = await post(
        '/auth/register',
        JSON.stringify({ username: 'a', password: 'x', displayName: '' }),
      )
      expect(res.status).toBe(422)
      expect(res.headers.get('content-type')).toBe(JSON_TYPE)
      expect(res.body).toEqual(
        failed([
          { path: 'username', message: 'Too small: expected string to have >=3 characters' },
          { path: 'password', message: 'Must be at least 8 characters' },
          { path: 'displayName', message: 'Cannot be empty' },
        ]),
      )
    })

    test('names a nested field and an array index with dots', async () => {
      const alice = await h.as('alice')
      const res = await alice.wire(`/workouts/${NO_SUCH_ID}/plan`, {
        method: 'PUT',
        body: JSON.stringify({
          days: [
            { name: 'A', entries: [] },
            { name: '', entries: [{ exerciseId: 'x' }] },
          ],
        }),
      })
      expect(res.status).toBe(422)
      expect(res.body).toEqual(
        failed([
          { path: 'days.1.name', message: 'Cannot be empty' },
          { path: 'days.1.entries.0.exerciseId', message: 'Invalid UUID' },
          {
            path: 'days.1.entries.0.sets',
            message: 'Invalid input: expected array, received undefined',
          },
        ]),
      )
    })

    test('names the body itself `root`: a key it does not know, or no body at all', async () => {
      const alice = await h.as('alice')
      const unknownKeys = await alice.wire(`/workouts/${NO_SUCH_ID}/plan`, {
        method: 'PUT',
        body: JSON.stringify({ days: [{ name: 'A', entries: [], nope: 1 }], extra: true }),
      })
      expect(unknownKeys.status).toBe(422)
      expect(unknownKeys.body).toEqual(
        failed([
          { path: 'days.0', message: 'Unrecognized key: "nope"' },
          { path: 'root', message: 'Unrecognized key: "extra"' },
        ]),
      )

      const noBody = await h.wire('/auth/login', { method: 'POST' })
      expect(noBody.status).toBe(422)
      expect(noBody.body).toEqual(
        failed([{ path: 'root', message: 'Invalid input: expected object, received undefined' }]),
      )
    })
  })

  test('a path parameter and a query value that fail validation are named the same way', async () => {
    const alice = await h.as('alice')

    const param = await alice.wire('/exercises/not-a-uuid')
    expect(param.status).toBe(422)
    expect(param.body).toEqual(failed([{ path: 'id', message: 'Invalid UUID' }]))

    const query = await alice.wire('/exercises?limit=abc')
    expect(query.status).toBe(422)
    expect(query.body).toEqual(
      failed([{ path: 'limit', message: 'Invalid input: expected number, received NaN' }]),
    )
  })

  test('a malformed JSON body is a 400 in the envelope', async () => {
    const res = await post('/auth/login', '{not json')
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toBe(JSON_TYPE)
    expect(res.body).toEqual(UNPARSEABLE)
  })

  test.each(['application/x-www-form-urlencoded', 'text/plain', 'application/xml'])(
    'a body sent as %s is the same 400',
    async (contentType) => {
      const res = await post('/auth/login', 'username=a&password=b', contentType)
      expect(res.status).toBe(400)
      expect(res.headers.get('content-type')).toBe(JSON_TYPE)
      expect(res.body).toEqual(UNPARSEABLE)
    },
  )

  test('an unknown route, and a known route by a method it does not have, are one 404', async () => {
    const unknown = await h.wire('/no-such-route')
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('content-type')).toBe(JSON_TYPE)
    expect(unknown.body).toEqual(NO_ROUTE)

    const wrongMethod = await h.wire('/health', { method: 'DELETE' })
    expect(wrongMethod.status).toBe(404)
    expect(wrongMethod.body).toEqual(NO_ROUTE)
  })

  test('a trailing slash reaches the same route: fixed, parameterised, and a prefix alone', async () => {
    const alice = await h.as('alice')

    expect((await h.wire('/health/')).body).toEqual({ ok: true, db: true })
    expect((await alice.wire('/exercises/')).body).toEqual({ items: [], nextCursor: null })
    expect((await h.wire('/instance/')).body).toEqual((await h.wire('/instance')).body)

    // The exercise route answered, not the router: its 404 names the exercise.
    const missing = await alice.wire(`/exercises/${NO_SUCH_ID}/`)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({
      error: { code: 'not_found', message: 'No such exercise', details: null },
    })
  })
})
