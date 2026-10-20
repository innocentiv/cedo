import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedSources, versionOf } from './marker.ts'

/** The perf database is rebuilt when what built it changes. See marker.ts. */

test('the sources are the seed, the muscles and the migrations — never a test', async () => {
  const sources = await seedSources()
  expect(sources).toContain('apps/api/src/db/seed-perf/index.ts')
  expect(sources).toContain('apps/api/src/db/seed.ts')
  expect(sources).toContain('packages/contract/src/muscle.ts')
  expect(sources).toContain('apps/api/drizzle/0000_initial_schema.sql')
  expect(sources.some((path) => path.endsWith('.test.ts'))).toBe(false)
})

test('an edit, a new file or a rename changes the version; nothing else does', async () => {
  const root = await mkdtemp(join(tmpdir(), 'seed-version-'))
  try {
    await writeFile(join(root, 'a.ts'), 'export const rows = 1')
    // The same contents under another name: only the path tells them apart.
    await writeFile(join(root, 'b.ts'), 'export const rows = 1')
    const before = await versionOf(['a.ts'], root)

    expect(await versionOf(['a.ts'], root)).toBe(before)
    expect(await versionOf(['b.ts'], root)).not.toBe(before)
    expect(await versionOf(['a.ts', 'b.ts'], root)).not.toBe(before)
    await writeFile(join(root, 'a.ts'), 'export const rows = 3')
    expect(await versionOf(['a.ts'], root)).not.toBe(before)
  } finally {
    await rm(root, { recursive: true })
  }
})
