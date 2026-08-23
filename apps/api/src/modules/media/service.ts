import { eq } from 'drizzle-orm'
import { type Media, type MediaCreateLink, parseMediaUrl } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { media } from '../../db/schema.ts'
import { invalid, notFound } from '../../lib/error.ts'
import { processImage } from '../../lib/media.ts'
import { blobStore } from '../../lib/storage/instance.ts'
import { toMedia } from '../exercise/mapper.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * Media are immutable once created: an id always addresses the same bytes or the same link. That
 * is why attaching one to an exercise shares the row rather than copying it, and why there is no
 * update endpoint. See docs/adr/0009-media-model.md.
 */

/** Links need no upload and no network call — provider and id are read from the URL itself. */
export async function createLink(caller: Caller, input: MediaCreateLink): Promise<Media> {
  const payload = parseMediaUrl(input.url)
  if (payload === null) throw invalid('That is not a usable URL')

  const [created] = await db
    .insert(media)
    .values({ kind: 'video_link', title: input.title, payload, createdBy: caller.userId })
    .returning()
  if (created === undefined) throw new Error('Could not create the media record')
  return toMedia(created)
}

export async function upload(caller: Caller, file: File): Promise<Media> {
  const processed = await processImage(new Uint8Array(await file.arrayBuffer()))

  const [blobKey, thumbnailKey] = await Promise.all([
    blobStore().put(processed.bytes, processed.mime),
    blobStore().put(processed.thumbnail, 'image/webp'),
  ])

  const [created] = await db
    .insert(media)
    .values({
      kind: 'image',
      title: file.name,
      thumbnailKey,
      createdBy: caller.userId,
      payload: {
        kind: 'image',
        blobKey,
        mime: processed.mime,
        width: processed.width,
        height: processed.height,
        byteSize: processed.bytes.byteLength,
        sha256: blobKey.split('/').at(-1)?.split('.')[0] ?? '',
      },
    })
    .returning()
  if (created === undefined) throw new Error('Could not create the media record')
  return toMedia(created)
}

export interface StoredBytes {
  readonly bytes: Uint8Array
  readonly contentType: string
}

/**
 * Serves the bytes for an uploaded image. Media are not ownable — an id is an opaque uuid and the
 * bytes are content-addressed — so any authenticated caller may fetch one they hold an id for.
 * Guessing an id is not a realistic attack; enumerating group membership would be, which is why
 * ATTACHING media checks visibility while serving does not.
 */
export async function bytesFor(id: string, variant: 'blob' | 'thumb'): Promise<StoredBytes> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1)
  if (row === undefined || row.payload.kind !== 'image') throw notFound('media')

  const key = variant === 'thumb' ? row.thumbnailKey : row.payload.blobKey
  if (key === null) throw notFound('media')

  const bytes = await blobStore().get(key)
  if (bytes === null) throw notFound('media')

  return { bytes, contentType: variant === 'thumb' ? 'image/webp' : row.payload.mime }
}
