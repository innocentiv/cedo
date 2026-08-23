import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import { type BlobStore, blobKeyFor, sha256Of } from './index.ts'

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
}

/**
 * Files on a docker volume. Phase 1, and probably phase 5 too — a self-hosted instance has no
 * object store and does not want one.
 */
export class LocalBlobStore implements BlobStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = resolve(root)
  }

  /**
   * Keys are generated from a digest, never from user input — but this class is the only thing
   * standing between a key and the filesystem, so it refuses to resolve outside its root anyway.
   */
  #pathFor(key: string): string {
    const full = normalize(join(this.#root, key))
    if (!full.startsWith(this.#root + '/'))
      throw new Error(`Refusing to resolve outside the blob root: ${key}`)
    return full
  }

  async put(bytes: Uint8Array, contentType: string): Promise<string> {
    const key = blobKeyFor(sha256Of(bytes), EXTENSION_BY_TYPE[contentType] ?? '')
    const path = this.#pathFor(key)

    // Content-addressed, so identical bytes are already the right bytes.
    if (await Bun.file(path).exists()) return key

    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, bytes)
    return key
  }

  async get(key: string): Promise<Uint8Array | null> {
    const file = Bun.file(this.#pathFor(key))
    if (!(await file.exists())) return null
    return new Uint8Array(await file.arrayBuffer())
  }

  async delete(key: string): Promise<void> {
    await rm(this.#pathFor(key), { force: true })
  }

  async exists(key: string): Promise<boolean> {
    return await Bun.file(this.#pathFor(key)).exists()
  }
}
