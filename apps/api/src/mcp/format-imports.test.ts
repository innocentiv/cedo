import { expect, test } from 'bun:test'
import { Glob } from 'bun'

/**
 * A formatter is a contract value in, text out, and is tested by a call (docs/07-mcp.md, "Adding a
 * tool") — which holds only while no `format*.ts` loads the database. One did, twice: three
 * thresholds taken from the review's service, and the read of the caller's groups kept beside the
 * lines that name them. So what a format file may import is checked, not left to care: the
 * contract, its sibling format files, and the review's thresholds where they are defined, in a
 * module that reads nothing. A type costs nothing at runtime, but only as `import type`:
 * `import { type X }` still loads its module.
 */
const ALLOWED = [
  /^@cedo\/contract$/u,
  /^\.\/format[\w-]*\.ts$/u,
  /^\.\.\/modules\/review\/deload\.ts$/u,
]

test('a format file loads only the contract, its siblings and the review’s pure thresholds', async () => {
  const files = [...new Glob('format*.ts').scanSync({ cwd: import.meta.dir })]
    .filter((file) => !file.endsWith('.test.ts'))
    .toSorted()
  // A glob that matched nothing would pass everything below.
  expect(files).toContain('format.ts')
  expect(files.length).toBeGreaterThanOrEqual(7)

  const refused = await Promise.all(
    files.map(async (file) => {
      const source = await Bun.file(`${import.meta.dir}/${file}`).text()
      const loaded = [...source.matchAll(/^import (?!type\b)[^']*'(?<from>[^']+)'/gmu)].map(
        (match) => match.groups?.['from'] ?? '',
      )
      return loaded
        .filter((from) => !ALLOWED.some((allowed) => allowed.test(from)))
        .map((from) => `${file} imports ${from}`)
    }),
  )
  expect(refused.flat()).toEqual([])
})
