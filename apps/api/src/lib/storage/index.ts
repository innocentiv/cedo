/**
 * Where uploaded bytes live. One interface so the phase-1 local volume can become S3 or MinIO by
 * adding a file, not by touching any service. See docs/09-deployment.md.
 */
export interface BlobStore {
  /** Returns the key the bytes were stored under. Implementations are content-addressed. */
  put(bytes: Uint8Array, contentType: string): Promise<string>
  get(key: string): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

/**
 * Content-addressed: the key IS the digest, so re-uploading identical bytes is free and
 * deduplicates across users without any bookkeeping. Sharded two levels so a directory never
 * accumulates hundreds of thousands of entries.
 */
export function blobKeyFor(sha256: string, extension: string): string {
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}${extension}`
}

export function sha256Of(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}
