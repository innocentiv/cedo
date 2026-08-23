/**
 * The `docs/` tree is this project's primary deliverable: it is what lets a future session extend
 * the codebase without drifting. A dead reference there wastes a whole cycle, so it fails the gate.
 *
 * Two kinds of reference are checked:
 *   1. Relative Markdown links in any `.md` file.
 *   2. `docs/...md` paths mentioned in source comments — a pointer an AI will actually follow.
 *
 * External URLs are never fetched.
 */
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.expo', '.artifacts', '.tsbuild'])
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)/gu
const DOCS_REFERENCE = /docs\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md/gu
const EXTERNAL = /^(?:https?:|mailto:)/u
const SOURCE_EXTENSIONS = ['.ts', '.tsx']

/**
 * Documentation referenced by code that already exists but whose file lands in a later milestone.
 * DELETE AN ENTRY THE MOMENT ITS DOC IS WRITTEN — this list is meant to shrink to nothing.
 */
const PLANNED: Readonly<Record<string, string>> = {
  'docs/03-domain-model.md': 'M2 — database',
  'docs/05-database.md': 'M2 — database',
  'docs/06-api.md': 'M3 — API core',
  'docs/07-mcp.md': 'M6 — MCP',
  'docs/08-frontend.md': 'M8 — frontend foundation',
  'docs/09-deployment.md': 'M10 — deployment',
  'docs/10-testing.md': 'M7 — performance',
}

interface Reference {
  readonly from: string
  readonly target: string
  readonly path: string
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .filter((e) => !SKIP.has(e.name))
      .map(async (e) => {
        const full = join(dir, e.name)
        if (e.isDirectory()) return await walk(full)
        return [full]
      }),
  )
  return nested.flat()
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const files = await walk(ROOT)

const references: Reference[] = (
  await Promise.all(
    files.map(async (file): Promise<Reference[]> => {
      const isMarkdown = file.endsWith('.md')
      const isSource = SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext))
      if (!isMarkdown && !isSource) return []

      const text = await Bun.file(file).text()

      if (isMarkdown) {
        return [...text.matchAll(MARKDOWN_LINK)]
          .map(([, target]) => target)
          .filter((t): t is string => t !== undefined && !EXTERNAL.test(t))
          .map((target) => ({ from: file, target, path: normalize(join(dirname(file), target)) }))
      }

      // Source comments name docs from the repository root, not relative to the file.
      return [...new Set(text.match(DOCS_REFERENCE) ?? [])].map((target) => ({
        from: file,
        target,
        path: join(ROOT, target),
      }))
    }),
  )
).flat()

const checked = await Promise.all(references.map(async (r) => ({ r, ok: await exists(r.path) })))
const missing = checked.filter(({ ok }) => !ok).map(({ r }) => r)

const broken = missing.filter((r) => PLANNED[r.target] === undefined)
const deferred = missing.filter((r) => PLANNED[r.target] !== undefined)

if (broken.length > 0) {
  console.error(`Broken documentation references (${broken.length}):`)
  for (const { from, target } of broken) console.error(`  ${relative(ROOT, from)} -> ${target}`)
  process.exit(1)
}

const stale = Object.keys(PLANNED).filter((target) => Bun.file(join(ROOT, target)).size > 0)
if (stale.length > 0) {
  console.error('These docs now exist — remove them from PLANNED in scripts/check-doc-links.ts:')
  for (const target of stale) console.error(`  ${target}`)
  process.exit(1)
}

console.log(`All ${references.length - deferred.length} documentation references resolve.`)
if (deferred.length > 0) {
  const pending = [...new Set(deferred.map((r) => r.target))].toSorted()
  console.log(`${pending.length} referenced docs are planned for a later milestone:`)
  for (const target of pending) console.log(`  ${target} (${PLANNED[target]})`)
}
