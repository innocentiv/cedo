import { beforeEach, describe, expect, test } from 'bun:test'
import { ApiError, Exercise, Media } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { notAnImage, samplePng } from '../../test/fixtures.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

async function uploadAs(user: TestUser, bytes: Uint8Array, filename = 'lift.png') {
  const form = new FormData()
  form.set('file', new File([bytes], filename, { type: 'image/png' }))
  return await user.wire('/media', { method: 'POST', body: form })
}

describe('links', () => {
  test('a YouTube URL becomes an embeddable, thumbnailed reference with no upload', async () => {
    const res = await alice.wire('/media/link', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'How to bench' }),
    })
    const created = expectContract(Media, res.body)
    expect(created.kind).toBe('video_link')
    expect(created.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(created.thumbnailUrl).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })

  test('an unrecognised host is still a usable link, just not embeddable', async () => {
    const created = expectContract(
      Media,
      (
        await alice.wire('/media/link', {
          method: 'POST',
          body: JSON.stringify({ url: 'https://example.com/clip.mp4' }),
        })
      ).body,
    )
    expect(created.url).toBe('https://example.com/clip.mp4')
    expect(created.embedUrl).toBeNull()
  })

  test('rejects something that is not a URL', async () => {
    const res = await alice.wire('/media/link', {
      method: 'POST',
      body: JSON.stringify({ url: 'not a url' }),
    })
    expect(res.status).toBe(422)
    expectContract(ApiError, res.body)
  })
})

describe('uploads', () => {
  test('stores the image, measures it, and generates a webp thumbnail', async () => {
    const res = await uploadAs(alice, samplePng())
    const created = expectContract(Media, res.body)

    expect(created.kind).toBe('image')
    expect(created.width).toBe(600)
    expect(created.height).toBe(400)
    expect(created.thumbnailUrl).not.toBeNull()

    const blob = await alice.wire(`/media/${created.id}/blob`)
    expect(blob.status).toBe(200)

    const thumb = await alice.wire(`/media/${created.id}/thumb`)
    expect(thumb.status).toBe(200)
  })

  test('rejects bytes that are not a decodable image', async () => {
    const res = await uploadAs(alice, notAnImage())
    expect(res.status).toBe(422)
    expectContract(ApiError, res.body)
  })

  /** The declared content-type is never trusted; `Bun.Image` reports what the bytes really are. */
  test('a file lying about its type is judged on its actual bytes', async () => {
    const form = new FormData()
    form.set('file', new File([notAnImage()], 'lies.png', { type: 'image/png' }))
    const res = await alice.wire('/media', { method: 'POST', body: form })
    expect(res.status).toBe(422)
  })

  test('a request with no file field is a 422, not a crash', async () => {
    const res = await alice.wire('/media', { method: 'POST', body: new FormData() })
    expect(res.status).toBe(422)
  })

  /** A truncated upload is a different problem from a missing field, and says so. */
  test('a body that is not multipart at all is a 422 that says so', async () => {
    const res = await alice.wire('/media', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=cut' },
      body: '--cut\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\n\r\nPNG',
    })
    expect(res.status).toBe(422)
    expect(expectContract(ApiError, res.body).error.message).toStartWith(
      'The request body is not valid multipart/form-data',
    )
  })

  /** Content-addressed storage: identical bytes are stored once, however many times uploaded. */
  test('uploading the same image twice reuses the stored bytes', async () => {
    const first = expectContract(Media, (await uploadAs(alice, samplePng())).body)
    const second = expectContract(Media, (await uploadAs(bob, samplePng())).body)

    // Distinct records — different owners, different titles are possible — but both resolve.
    expect(first.id).not.toBe(second.id)
    expect((await alice.wire(`/media/${first.id}/blob`)).status).toBe(200)
    expect((await bob.wire(`/media/${second.id}/blob`)).status).toBe(200)
  })

  test('uploads require authentication', async () => {
    const form = new FormData()
    form.set('file', new File([samplePng()], 'x.png', { type: 'image/png' }))
    expect((await h.wire('/media', { method: 'POST', body: form })).status).toBe(401)
  })
})

describe('attaching media to an exercise', () => {
  const anExercise = (mediaIds: string[]) => ({
    name: 'Bench Press',
    muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
    mediaIds,
  })

  test('resolved media come back with the exercise, in order', async () => {
    const a = expectContract(Media, (await uploadAs(alice, samplePng(64, 64), 'a.png')).body)
    const b = expectContract(
      Media,
      (
        await alice.wire('/media/link', {
          method: 'POST',
          body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
        })
      ).body,
    )

    const exercise = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify(anExercise([a.id, b.id])),
        })
      ).body,
    )
    expect(exercise.media.map((m) => m.id)).toEqual([a.id, b.id])
    expect(exercise.media.map((m) => m.kind)).toEqual(['image', 'video_link'])
  })

  test('attaching an unknown media id is a 404, not a dangling reference', async () => {
    const res = await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify(anExercise([crypto.randomUUID()])),
    })
    expect(res.status).toBe(404)
  })

  test('detaching media leaves the media itself intact for other exercises', async () => {
    const image = expectContract(Media, (await uploadAs(alice, samplePng(64, 64))).body)
    const first = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify(anExercise([image.id])),
        })
      ).body,
    )
    const second = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({ ...anExercise([image.id]), name: 'Incline Press' }),
        })
      ).body,
    )

    await alice.wire(`/exercises/${first.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ mediaIds: [] }),
    })

    expect(
      expectContract(Exercise, (await alice.wire(`/exercises/${first.id}`)).body).media,
    ).toHaveLength(0)
    expect(
      expectContract(Exercise, (await alice.wire(`/exercises/${second.id}`)).body).media,
    ).toHaveLength(1)
    expect((await alice.wire(`/media/${image.id}/blob`)).status).toBe(200)
  })
})
