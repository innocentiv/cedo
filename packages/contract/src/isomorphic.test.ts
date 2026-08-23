import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * This package runs in three very different places: a browser, the Bun server, and React Native on
 * a phone. A runtime-specific global compiles fine here (the tsconfig loads Bun's types so the
 * colocated tests can run) but would crash on a device.
 *
 * `types: ["bun"]` is therefore load-bearing for the tests and dangerous for the source, and this
 * test is what makes that safe. See docs/01-architecture.md.
 */
const FORBIDDEN = [
  { pattern: /\bBun\./u, why: 'Bun global — not available in a browser or React Native' },
  { pattern: /\bprocess\./u, why: 'Node process global — not available in a browser' },
  { pattern: /\brequire\(/u, why: 'CommonJS require — this package is ESM only' },
  { pattern: /from ['"]node:/u, why: 'Node built-in — not available in a browser or React Native' },
  { pattern: /\bdocument\./u, why: 'DOM global — this package also runs on the server' },
  { pattern: /\bwindow\./u, why: 'DOM global — this package also runs on the server' },
  { pattern: /\blocalStorage\b/u, why: 'DOM global — this package also runs on the server' },
]

const SRC = join(import.meta.dir)

async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(SRC, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => e.name)
}

describe('the contract package stays isomorphic', () => {
  test('there is source to check', async () => {
    expect((await sourceFiles()).length).toBeGreaterThan(5)
  })

  test('no runtime-specific global appears in source', async () => {
    const offences: string[] = []
    for (const name of await sourceFiles()) {
      const text = await Bun.file(join(SRC, name)).text()
      const code = text.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/.*/gu, '')
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(code)) offences.push(`${name}: ${pattern.source} — ${why}`)
      }
    }
    expect(offences).toEqual([])
  })

  test('the only runtime dependency is zod', async () => {
    const pkg = z
      .object({ dependencies: z.record(z.string(), z.string()) })
      .parse(await Bun.file(join(SRC, '..', 'package.json')).json())
    expect(Object.keys(pkg.dependencies)).toEqual(['zod'])
  })
})
