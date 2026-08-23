/**
 * The `docs/` tree is this project's primary deliverable: it is what lets a future session extend
 * the codebase without drifting. A dead reference there wastes a whole cycle, so it fails the gate.
 *
 * Three things are checked:
 *   1. Relative Markdown links in any `.md` file.
 *   2. `docs/...md` paths mentioned anywhere — a source comment OR markdown prose. Prose was the
 *      original blind spot: four documents promised `docs/playbooks/add-entity.md` in backticks,
 *      which is not a Markdown link, so nothing noticed the file did not exist.
 *   3. That every ADR file appears in the ADR index, which had drifted to missing three of eight.
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
  'docs/07-mcp.md': 'M6 — MCP',
  'docs/08-frontend.md': 'M8 — frontend foundation',
  'docs/09-deployment.md': 'M10 — deployment',
  'docs/10-testing.md': 'M7 — performance',
}

interface Reference {
  readonly from: string
  /** As written, for the error message. */
  readonly target: string
  /** Absolute path on disk. */
  readonly path: string
  /**
   * Root-relative, so PLANNED can be keyed one way for both reference kinds. Markdown links are
   * written relative to their own file (`../10-testing.md`), which would never match a PLANNED
   * key and so could never be deferred.
   */
  readonly key: string
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

      /**
       * Root-relative `docs/...md` mentions, wherever they appear — in a source comment OR in
       * markdown prose. Prose references were the blind spot: three documents promised
       * `docs/playbooks/add-entity.md` in backticks, which is not a markdown link, so nothing
       * noticed that the file did not exist.
       */
      const prose = [...new Set(text.match(DOCS_REFERENCE) ?? [])].map((target) => ({
        from: file,
        target,
        path: join(ROOT, target),
        key: target,
      }))

      if (!isMarkdown) return prose

      const links = [...text.matchAll(MARKDOWN_LINK)]
        .map(([, target]) => target)
        .filter((t): t is string => t !== undefined && !EXTERNAL.test(t))
        .map((target) => {
          const path = normalize(join(dirname(file), target))
          return { from: file, target, path, key: relative(ROOT, path) }
        })

      links.push(...prose)
      return links
    }),
  )
).flat()

const checked = await Promise.all(references.map(async (r) => ({ r, ok: await exists(r.path) })))
const missing = checked.filter(({ ok }) => !ok).map(({ r }) => r)

const broken = missing.filter((r) => PLANNED[r.key] === undefined)
const deferred = missing.filter((r) => PLANNED[r.key] !== undefined)

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

/**
 * Every ADR must appear in the ADR index. Keeping an index current by discipline does not work —
 * this one silently drifted to missing three of eight entries.
 */
const adrDir = join(ROOT, 'docs', 'adr')
const adrIndex = await Bun.file(join(adrDir, 'README.md')).text()
const unlisted = (await readdir(adrDir))
  .filter((name) => /^\d{4}-.*\.md$/u.test(name))
  .filter((name) => !adrIndex.includes(name))

if (unlisted.length > 0) {
  console.error(`ADRs missing from docs/adr/README.md (${unlisted.length}):`)
  for (const name of unlisted) console.error(`  ${name}`)
  process.exit(1)
}

console.log(`All ${references.length - deferred.length} documentation references resolve.`)
console.log(
  `All ${(await readdir(adrDir)).filter((n) => /^\d{4}-/u.test(n)).length} ADRs are indexed.`,
)
if (deferred.length > 0) {
  const pending = [...new Set(deferred.map((r) => r.key))].toSorted()
  console.log(`${pending.length} referenced docs are planned for a later milestone:`)
  for (const target of pending) console.log(`  ${target} (${PLANNED[target]})`)
}
