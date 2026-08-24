import { z } from 'zod'
import { Id, NonEmptyString, Timestamp } from './primitives.ts'

/**
 * Media attached to an exercise. Most references are links to a video (a YouTube demonstration is
 * the common case), not uploads — but uploads are supported, and more kinds are expected later.
 *
 * The shape mirrors `progression`: stable columns plus a JSONB `payload` validated by a
 * discriminated union. Adding `video_upload`, `gif` or `model_3d` later means extending the union
 * and nothing else — no migration. See docs/03-domain-model.md.
 */

export const MEDIA_KINDS = ['image', 'video_link'] as const
export const MediaKind = z.enum(MEDIA_KINDS)
export type MediaKind = z.output<typeof MediaKind>

export const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'url'] as const
export const VideoProvider = z.enum(VIDEO_PROVIDERS)
export type VideoProvider = z.output<typeof VideoProvider>

/** An uploaded file. `blobKey` addresses it in the BlobStore and never leaves the server. */
export const ImagePayload = z.object({
  kind: z.literal('image'),
  blobKey: NonEmptyString,
  mime: NonEmptyString,
  width: z.int().positive(),
  height: z.int().positive(),
  byteSize: z.int().positive(),
  sha256: z.string().length(64),
})

/** A link to video hosted elsewhere. `externalId` is null for a generic URL we could not parse. */
export const VideoLinkPayload = z.object({
  kind: z.literal('video_link'),
  provider: VideoProvider,
  sourceUrl: z.url(),
  externalId: z.string().nullable(),
})

/** Stored in the `media.payload` JSONB column. Internal — see `Media` for the wire shape. */
export const MediaPayload = z.discriminatedUnion('kind', [ImagePayload, VideoLinkPayload])
export type MediaPayload = z.output<typeof MediaPayload>
export type VideoLinkPayload = z.output<typeof VideoLinkPayload>

/**
 * What the client receives. Deliberately flat and free of storage internals: the UI renders these
 * fields directly and performs no derivation of its own (invariant 7, CLAUDE.md).
 */
export const Media = z.object({
  id: Id,
  kind: MediaKind,
  title: z.string(),
  /**
   * Full-size. For an upload this is a path RELATIVE TO THE API ROOT (`/media/:id/blob`) which a
   * client must resolve against its own base — the server cannot know whether it is reached at
   * `/api` behind a proxy or at an absolute host from a native build. For a link it is the original
   * page, already absolute. `thumbnailUrl` follows the same rule.
   */
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** Embeddable player URL; null when the media is not embeddable. */
  embedUrl: z.string().nullable(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  createdAt: Timestamp,
})
export type Media = z.output<typeof Media>

export const MediaCreateLink = z.strictObject({
  url: z.url(),
  title: z.string().max(200).default(''),
})
export type MediaCreateLink = z.output<typeof MediaCreateLink>

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'])
const YOUTUBE_ID = /^[\w-]{11}$/u
const VIMEO_ID = /^\d+$/u

/**
 * Pure. No network call and no API key — provider and id are read from the URL itself, so creating
 * a media link never depends on a third party being reachable.
 *
 * Returns a `video_link` payload for any valid URL; `provider: 'url'` when the host is unrecognised.
 * Returns null only when the input is not a URL at all.
 */
export function parseMediaUrl(input: string): VideoLinkPayload | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  if (YOUTUBE_HOSTS.has(host)) {
    const id = youtubeId(host, url, segments)
    if (id !== null)
      return { kind: 'video_link', provider: 'youtube', sourceUrl: input.trim(), externalId: id }
  }

  if (VIMEO_HOSTS.has(host)) {
    const candidate = segments.at(-1)
    if (candidate !== undefined && VIMEO_ID.test(candidate)) {
      return {
        kind: 'video_link',
        provider: 'vimeo',
        sourceUrl: input.trim(),
        externalId: candidate,
      }
    }
  }

  return { kind: 'video_link', provider: 'url', sourceUrl: input.trim(), externalId: null }
}

function youtubeId(host: string, url: URL, segments: string[]): string | null {
  // youtu.be/<id>
  if (host === 'youtu.be') return validYoutubeId(segments[0])
  // youtube.com/watch?v=<id>
  const query = url.searchParams.get('v')
  if (query !== null) return validYoutubeId(query)
  // youtube.com/{shorts,embed,live,v}/<id>
  const [prefix, id] = segments
  if (prefix !== undefined && ['shorts', 'embed', 'live', 'v'].includes(prefix))
    return validYoutubeId(id)
  return null
}

function validYoutubeId(candidate: string | undefined): string | null {
  return candidate !== undefined && YOUTUBE_ID.test(candidate) ? candidate : null
}

/** Pure. Keyless thumbnail derivation. Vimeo has none without an oEmbed call, so it returns null. */
export function videoThumbnailUrl(payload: VideoLinkPayload): string | null {
  if (payload.provider === 'youtube' && payload.externalId !== null) {
    return `https://img.youtube.com/vi/${payload.externalId}/hqdefault.jpg`
  }
  return null
}

/** Pure. Embeddable player URL, or null when the link cannot be embedded. */
export function videoEmbedUrl(payload: VideoLinkPayload): string | null {
  if (payload.externalId === null) return null
  if (payload.provider === 'youtube') return `https://www.youtube.com/embed/${payload.externalId}`
  if (payload.provider === 'vimeo') return `https://player.vimeo.com/video/${payload.externalId}`
  return null
}
