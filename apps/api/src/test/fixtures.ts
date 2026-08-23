import { deflateSync } from 'node:zlib'

/**
 * A minimal PNG encoder, so image tests use genuine image bytes without committing a large binary
 * blob as a base64 literal. `Bun.Image` correctly rejects anything that is not a real image, which
 * is exactly the behaviour under test.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xff_ff_ff_ff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xff_ff_ff_ff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes)
  body.set(data, typeBytes.length)

  const out = new Uint8Array(8 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(body, 4)
  view.setUint32(4 + body.length, crc32(body))
  return out
}

/** A real RGB PNG with a deterministic gradient. */
export function samplePng(width = 600, height = 400): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3))
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset] = 0 // filter type: none
    offset += 1
    for (let x = 0; x < width; x++) {
      raw[offset] = (x * 3) % 256
      raw[offset + 1] = (y * 5) % 256
      raw[offset + 2] = 200
      offset += 3
    }
  }

  const ihdr = new Uint8Array(13)
  const header = new DataView(ihdr.buffer)
  header.setUint32(0, width)
  header.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    // node:zlib, NOT Bun.deflateSync: PNG's IDAT must be zlib-wrapped (0x78 header), and
    // Bun.deflateSync emits RAW deflate. With raw bytes the header still parses — so metadata()
    // succeeds — and only the pixel decode fails, which is a confusing way to find out.
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]

  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    png.set(part, at)
    at += part.length
  }
  return png
}

/** Bytes that are definitively not an image, for the rejection path. */
export const notAnImage = (): Uint8Array => new TextEncoder().encode('this is plainly not a PNG')
