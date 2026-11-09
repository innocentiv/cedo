import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalBlobStore } from './local.ts'

/** The blob store a self-hosted instance runs on: files under one root, named by their digest. */
let root: string
let store: LocalBlobStore
const bytes = new TextEncoder().encode('a photo of a squat rack')
// `printf '%s' 'a photo of a squat rack' | shasum -a 256`, sharded two levels.
const SHARD = '24/e7'
const NAME = '24e784828bddd25d506216d5491f1c0d40a34e765850aa0b9b831a6a1bdbb173.png'
const KEY = `${SHARD}/${NAME}`

/** What `attempt` was refused with, or null if it was not. */
const refusalOf = async (attempt: Promise<unknown>): Promise<string | null> =>
  await attempt.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cedo-blobs-'))
  store = new LocalBlobStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('LocalBlobStore', () => {
  test('stores bytes under their digest, sharded two levels, and the same bytes twice as one', async () => {
    expect(await store.put(bytes, 'image/png')).toBe(KEY)
    expect(await store.put(bytes, 'image/png')).toBe(KEY)
    expect(await readdir(join(root, SHARD))).toEqual([NAME])
  })

  test('reads back what it stored, and nothing once it is deleted', async () => {
    const key = await store.put(bytes, 'image/png')
    expect(await store.exists(key)).toBe(true)
    expect(await store.get(key)).toEqual(bytes)

    await store.delete(key)
    expect(await store.exists(key)).toBe(false)
    expect(await store.get(key)).toBeNull()
    // Deleting what is not there is not an error: a media row and its blob go separately.
    await store.delete(key)
  })

  test('refuses a key that would resolve outside its root', async () => {
    const refusal = 'Refusing to resolve outside the blob root: ../escape.png'
    expect(await refusalOf(store.get('../escape.png'))).toBe(refusal)
    expect(await refusalOf(store.exists('../escape.png'))).toBe(refusal)
    expect(await refusalOf(store.delete('../escape.png'))).toBe(refusal)
  })

  /**
   * Content-addressed, a half-written blob would be permanent: every later put of those bytes finds
   * the name taken and returns early. So a write that fails leaves nothing under the blob's name,
   * and no temporary file beside it.
   */
  test('a write that fails leaves neither the blob nor its temporary file behind', async () => {
    // A directory where the blob would go, with something in it: the rename onto it fails.
    await mkdir(join(root, KEY, 'occupied'), { recursive: true })

    expect(await refusalOf(store.put(bytes, 'image/png'))).not.toBeNull()
    expect(await readdir(join(root, SHARD))).toEqual([NAME])
    expect(await readdir(join(root, KEY))).toEqual(['occupied'])
  })
})
