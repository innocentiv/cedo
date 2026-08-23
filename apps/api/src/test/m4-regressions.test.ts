import { beforeEach, describe, expect, test } from 'bun:test'
import { ApiError, Exercise } from '@cedo/contract'
import * as ExerciseService from '../modules/exercise/service.ts'
import { expectContract } from './contract.ts'
import { samplePng } from './fixtures.ts'
import { type TestApi, type TestUser, makeApi } from './harness.ts'

/**
 * One case per defect found in the M4 review. Each was verified to fail against the code as it
 * stood before the fix.
 */

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

const anExercise = (over: Record<string, unknown> = {}) => ({
  name: 'Regression Lift',
  muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
  ...over,
})

async function uploadImage(user: TestUser): Promise<string> {
  const form = new FormData()
  form.set('file', new File([samplePng(64, 64)], 'x.png', { type: 'image/png' }))
  const res = await user.wire('/media', { method: 'POST', body: form })
  return expectContract((await import('@cedo/contract')).Media, res.body).id
}

describe('duplicate media ids', () => {
  test('are a 422, not a duplicate-key 500', async () => {
    const id = await uploadImage(alice)
    const res = await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify(anExercise({ mediaIds: [id, id] })),
    })
    expect(res.status).toBe(422)
    expect(expectContract(ApiError, res.body).error.code).toBe('validation_failed')
  })

  test('are rejected on update too', async () => {
    const id = await uploadImage(alice)
    const created = expectContract(
      Exercise,
      (await alice.wire('/exercises', { method: 'POST', body: JSON.stringify(anExercise()) })).body,
    )
    const res = await alice.wire(`/exercises/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ mediaIds: [id, id] }),
    })
    expect(res.status).toBe(422)
  })
})

describe('search terms are not wildcards', () => {
  test('a literal % matches only names containing it', async () => {
    await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify(anExercise({ name: '50% Squat' })),
    })
    await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify(anExercise({ name: '50 Squat' })),
    })

    const res = await alice.wire('/exercises?q=50%25')
    const found = expectContract((await import('@cedo/contract')).page(Exercise), res.body)
    expect(found.items.map((e) => e.name)).toEqual(['50% Squat'])
  })

  test('a lone underscore does not match everything', async () => {
    await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify(anExercise({ name: 'Plain Squat' })),
    })
    const res = await alice.wire('/exercises?q=_')
    const found = expectContract((await import('@cedo/contract')).page(Exercise), res.body)
    expect(found.items).toHaveLength(0)
  })
})

describe("scope 'group' without a groupId", () => {
  /** The HTTP route is protected by the schema, but MCP tools call the service directly. */
  test('is a validation error from the service, not a uuid cast crash', async () => {
    let message = '(nothing was thrown)'
    try {
      await ExerciseService.list(alice.caller, { scope: 'group', limit: 50 })
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/groupId is required/u)
  })
})

describe('image bytes are served without a bearer token', () => {
  /**
   * `Media.url` is published for the UI to render with `<img src>`, and an img tag cannot send an
   * Authorization header. Behind the auth guard every uploaded image rendered broken.
   */
  test('an anonymous request can fetch a blob and a thumbnail', async () => {
    const id = await uploadImage(alice)

    const blob = await h.wire(`/media/${id}/blob`)
    expect(blob.status).toBe(200)

    const thumb = await h.wire(`/media/${id}/thumb`)
    expect(thumb.status).toBe(200)
  })

  test('but creating media still requires a session', async () => {
    const res = await h.wire('/media/link', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('the write in update() carries its own permission check', () => {
  test('a non-editor cannot patch, and the row is untouched', async () => {
    const mine = expectContract(
      Exercise,
      (await alice.wire('/exercises', { method: 'POST', body: JSON.stringify(anExercise()) })).body,
    )
    const res = await bob.wire(`/exercises/${mine.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Hijacked' }),
    })
    expect(res.status).toBe(404)
    expect(expectContract(Exercise, (await alice.wire(`/exercises/${mine.id}`)).body).name).toBe(
      'Regression Lift',
    )
  })
})
