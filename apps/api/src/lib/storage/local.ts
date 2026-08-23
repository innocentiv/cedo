import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import { EXTENSION_BY_MIME } from '../media.ts'
import { type BlobStore, blobKeyFor, sha256Of } from './index.ts'

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
    const key = blobKeyFor(sha256Of(bytes), EXTENSION_BY_MIME[contentType] ?? '')
    const path = this.#pathFor(key)

    // Content-addressed, so identical bytes are already the right bytes.
    if (await Bun.file(path).exists()) return key

    await mkdir(dirname(path), { recursive: true })

    /**
     * Written to a temporary name in the same directory and renamed, which is atomic on one
     * filesystem. A direct write is not: a concurrent uploader of the same bytes sees the
     * half-written file via `exists()` and returns early, and a reader in between gets a truncated
     * blob. Under content addressing that corruption is PERMANENT — every later `put()` of those
     * bytes also short-circuits, so nothing ever repairs it.
     */
    const temporary = `${path}.${crypto.randomUUID()}.partial`
    try {
      await Bun.write(temporary, bytes)
      await rename(temporary, path)
    } catch (cause) {
      await rm(temporary, { force: true })
      throw cause
    }
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
