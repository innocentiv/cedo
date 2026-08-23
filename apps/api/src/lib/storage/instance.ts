import { env } from '../../env.ts'
import type { BlobStore } from './index.ts'
import { LocalBlobStore } from './local.ts'

/**
 * Lazily constructed so importing a service does not touch the filesystem, and so tests can point
 * UPLOAD_DIR somewhere disposable before the first use.
 */
let store: BlobStore | undefined

export function blobStore(): BlobStore {
  store ??= new LocalBlobStore(env.UPLOAD_DIR)
  return store
}

/** Tests only: swap in a store rooted at a temporary directory. */
export function setBlobStore(replacement: BlobStore): void {
  store = replacement
}
