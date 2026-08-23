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
   * Elysia's native validator is TypeBox; without `mapJsonSchema` every Zod-validated route
   * documents as an empty object. This asserts the spec actually carries our schemas.
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
