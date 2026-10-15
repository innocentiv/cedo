import { beforeEach, describe, expect, test } from 'bun:test'
import { ApiError, Exercise } from '@cedo/contract'
import { expectContract } from './contract.ts'
import { samplePng } from './fixtures.ts'
import { type TestApi, type TestUser, makeApi } from './harness.ts'

/**
 * Cases where a plausible implementation is subtly wrong.
 *
 * These do not belong to one module — each is a seam between two: a validation rule the database
 * would otherwise enforce as a 500, an auth check on the wrong layer. They live here rather than
 * beside a service because no single service owns them. What every ownable must do identically —
 * search escaping, the scope rule, cursors — is `modules/ownable/ownable.test.ts`, run per kind.
 *
 * Every test in this file was watched failing against the code before its fix. Add to it the same
 * way: reproduce first, then fix. See docs/10-testing.md.
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
