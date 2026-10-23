import { describe, expect, test } from 'bun:test'
import {
  MediaPayload,
  parseMediaUrl,
  uploadLimits,
  videoEmbedUrl,
  videoThumbnailUrl,
} from './media.ts'

const ID = 'dQw4w9WgXcQ'

describe('parseMediaUrl — YouTube', () => {
  test.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123&index=2`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=30`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ])('recognises %s', (url) => {
    const parsed = parseMediaUrl(url)
    expect(parsed?.provider).toBe('youtube')
    expect(parsed?.externalId).toBe(ID)
  })

  test('derives a keyless thumbnail and an embed URL', () => {
    const parsed = parseMediaUrl(`https://youtu.be/${ID}`)
    expect(parsed).not.toBeNull()
    expect(videoThumbnailUrl(parsed!)).toBe(`https://img.youtube.com/vi/${ID}/hqdefault.jpg`)
    expect(videoEmbedUrl(parsed!)).toBe(`https://www.youtube.com/embed/${ID}`)
  })

  test('a malformed video id falls back to a generic URL rather than a broken embed', () => {
    const parsed = parseMediaUrl('https://www.youtube.com/watch?v=tooshort')
    expect(parsed?.provider).toBe('url')
    expect(parsed?.externalId).toBeNull()
    expect(videoEmbedUrl(parsed!)).toBeNull()
  })
})

describe('parseMediaUrl — Vimeo', () => {
  test.each(['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'])(
    'recognises %s',
    (url) => {
      const parsed = parseMediaUrl(url)
      expect(parsed?.provider).toBe('vimeo')
      expect(parsed?.externalId).toBe('76979871')
    },
  )

  test('embeds, but has no keyless thumbnail', () => {
    const parsed = parseMediaUrl('https://vimeo.com/76979871')
    expect(videoEmbedUrl(parsed!)).toBe('https://player.vimeo.com/video/76979871')
    expect(videoThumbnailUrl(parsed!)).toBeNull()
  })
})

describe('parseMediaUrl — everything else', () => {
  test('an unrecognised host is still a valid link', () => {
    const parsed = parseMediaUrl('https://example.com/clip.mp4')
    expect(parsed).toEqual({
      kind: 'video_link',
      provider: 'url',
      sourceUrl: 'https://example.com/clip.mp4',
      externalId: null,
    })
  })

  test('surrounding whitespace is tolerated', () => {
    expect(parseMediaUrl(`  https://youtu.be/${ID}  `)?.externalId).toBe(ID)
  })

  test.each(['not a url', '', 'ftp://example.com/x', 'javascript:alert(1)', '//example.com'])(
    'rejects %p',
    (input) => {
      expect(parseMediaUrl(input)).toBeNull()
    },
  )
})

describe('MediaPayload', () => {
  test('parsed links satisfy the stored payload schema', () => {
    const parsed = parseMediaUrl(`https://youtu.be/${ID}`)
    expect(MediaPayload.safeParse(parsed).success).toBe(true)
  })

  test('discriminates image from video_link', () => {
    const image = {
      kind: 'image',
      blobKey: 'ab/cd/abcd',
      mime: 'image/webp',
      width: 800,
      height: 600,
      byteSize: 1234,
      sha256: 'a'.repeat(64),
    }
    expect(MediaPayload.safeParse(image).success).toBe(true)
    expect(MediaPayload.safeParse({ ...image, sha256: 'short' }).success).toBe(false)
    expect(MediaPayload.safeParse({ ...image, kind: 'nonsense' }).success).toBe(false)
  })
})

/** Said before a file is picked, as the API will hold it to (#13). */
describe('the upload limits', () => {
  test('read as a person reads them', () => {
    expect(uploadLimits()).toBe('JPEG, PNG, WebP or GIF, up to 12 MB')
  })
})
