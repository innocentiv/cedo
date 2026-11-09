import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env, isTest } from '../../env.ts'
import type { BlobStore } from './index.ts'
import { LocalBlobStore } from './local.ts'

/**
 * Lazily constructed so importing a service does not touch the filesystem, and so tests can point
 * UPLOAD_DIR somewhere disposable before the first use.
 */
let store: BlobStore | undefined

export function blobStore(): BlobStore {
  /**
   * Under test the configured UPLOAD_DIR is IGNORED, unconditionally — the same interlock env.ts
   * applies to DATABASE_URL. Relying on the harness to swap in a test store made it opt-in, so any
   * test or script that reached `upload()` without going through `makeApi()` would have written
   * into a real deployment directory.
   */
  store ??= isTest
    ? new LocalBlobStore(join(tmpdir(), `cedo-test-blobs-${Bun.env['BUN_TEST_WORKER_ID'] ?? '0'}`))
    : new LocalBlobStore(env.UPLOAD_DIR)
  return store
}
