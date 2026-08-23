/**
 * The `docs/` tree is this project's primary deliverable: it is what lets a future session extend
 * the codebase without drifting. A dead link there is a real defect, so it fails `bun run check`.
 *
 * Relative Markdown links only; external URLs are not fetched.
 */
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.expo', '.artifacts', '.tsbuild'])
const LINK = /\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)/gu
const EXTERNAL = /^(?:https?:|mailto:)/u

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .filter((e) => !SKIP.has(e.name))
      .map(async (e) => {
        const full = join(dir, e.name)
        if (e.isDirectory()) return await markdownFiles(full)
        return e.name.endsWith('.md') ? [full] : []
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

const files = await markdownFiles(ROOT)
const links = (
  await Promise.all(
    files.map(async (file) => {
      const text = await Bun.file(file).text()
      return [...text.matchAll(LINK)]
        .map(([, target]) => target)
        .filter((target): target is string => target !== undefined && !EXTERNAL.test(target))
        .map((target) => ({ file, target, path: normalize(join(dirname(file), target)) }))
    }),
  )
).flat()

const checked = await Promise.all(
  links.map(async (link) => ({ link, ok: await exists(link.path) })),
)
const broken = checked.filter(({ ok }) => !ok).map(({ link }) => link)

if (broken.length > 0) {
  console.error(`Broken documentation links (${broken.length}):`)
  for (const { file, target } of broken) console.error(`  ${relative(ROOT, file)} -> ${target}`)
  process.exit(1)
}
console.log(`All ${links.length} documentation links across ${files.length} files resolve.`)
