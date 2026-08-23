import { invalid } from './error.ts'

/**
 * Image handling via `Bun.Image`, built into the runtime — no `sharp`, no native addon, nothing to
 * compile on a NAS.
 */

/** Formats accepted on upload. Deliberately narrow: everything here decodes everywhere. */
export const ACCEPTED_IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'gif'] as const
export type AcceptedImageFormat = (typeof ACCEPTED_IMAGE_FORMATS)[number]

const MIME_BY_FORMAT: Readonly<Record<AcceptedImageFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** 12 MB. A phone photo is 3–5 MB; anything larger is a mistake or an attack. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

/** Long edge of the generated thumbnail. */
const THUMBNAIL_EDGE = 480

export interface ProcessedImage {
  readonly bytes: Uint8Array
  readonly thumbnail: Uint8Array
  readonly width: number
  readonly height: number
  /** Derived from the DECODED image, never from what the client claimed. */
  readonly mime: string
}

/**
 * Decodes, measures, and re-encodes a thumbnail.
 *
 * The declared content-type is ignored entirely: `metadata()` reports what the bytes actually are,
 * so a file claiming `image/png` that is really something else is either rejected or stored under
 * its true type — it can never become a broken image for every viewer.
 */
export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  if (bytes.byteLength === 0) throw invalid('The uploaded file is empty')
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw invalid(`Images must be under ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`)
  }

  let width: number
  let height: number
  let format: string
  try {
    const metadata = await new Bun.Image(bytes).metadata()
    width = metadata.width
    height = metadata.height
    format = metadata.format
  } catch {
    throw invalid('That file could not be decoded as an image')
  }

  if (!isAccepted(format)) {
    throw invalid(
      `Unsupported image format '${format}'. Accepted: ${ACCEPTED_IMAGE_FORMATS.join(', ')}`,
    )
  }

  /**
   * A fresh instance: the source is re-decoded rather than reusing a consumed pipeline.
   *
   * Wrapped separately because `metadata()` only reads the header — an image with a valid header
   * and corrupt pixel data passes the check above and fails HERE. Unwrapped, that is a 500 for
   * what is really a bad upload.
   */
  let thumbnail: Uint8Array
  try {
    thumbnail = await new Bun.Image(bytes)
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: 'inside' })
      .webp({ quality: 82 })
      .bytes()
  } catch {
    throw invalid('That image could not be decoded past its header')
  }

  return { bytes, thumbnail, width, height, mime: MIME_BY_FORMAT[format] }
}

function isAccepted(format: string): format is AcceptedImageFormat {
  return (ACCEPTED_IMAGE_FORMATS as readonly string[]).includes(format)
}
