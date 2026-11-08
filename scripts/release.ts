/**
 * `bun run release <version>` — cuts a release (#79, ADR-0032), from a clean `main` that is
 * `origin/main`: sets `VERSION` in the contract and the app's `version` and `ios.buildNumber` in
 * one commit, and tags it `v<version>`. Nothing is pushed: whoever cut it pushes `main` and the tag
 * together, which deploys `main` and builds the iPhone app on the tag (.github/workflows/ios.yml).
 *
 * `0.x` while AltStore is the only way the app is installed: a minor when the contract changes, a
 * patch otherwise. What it writes is `release-files.ts`, tested on its own.
 */
import { resolve } from 'node:path'
import { $ } from 'bun'
import { versionIn, whyNotNext, withAppVersion, withVersion } from './release-files.ts'

const ROOT = resolve(import.meta.dir, '..')
const INSTANCE = resolve(ROOT, 'packages/contract/src/instance.ts')
const APP = resolve(ROOT, 'apps/app/app.json')

function refuse(reason: string): never {
  console.error(reason)
  process.exit(1)
}

const wanted = Bun.argv[2]
if (wanted === undefined) refuse('Which version? bun run release 0.1.0')
const tag = `v${wanted}`

const git = $.cwd(ROOT)
if ((await git`git status --porcelain`.text()).trim() !== '') {
  refuse('The working tree has changes: commit or stash them first.')
}
const branch = (await git`git branch --show-current`.text()).trim()
if (branch !== 'main') refuse(`Releases are cut from main; this is ${branch}.`)
// Cut from what was pushed, so the tag's commit lands on main when both are pushed.
await git`git fetch --quiet origin main --tags`
const [local, pushed] = await Promise.all([
  git`git rev-parse main`.text(),
  git`git rev-parse origin/main`.text(),
])
if (local.trim() !== pushed.trim()) refuse('main is not origin/main: push or pull first.')
if ((await git`git tag --list ${tag}`.text()).trim() !== '') refuse(`${tag} is already a tag.`)

const instance = await Bun.file(INSTANCE).text()
const current = versionIn(instance)
if (current === null) refuse(`No VERSION in ${INSTANCE}.`)
const problem = whyNotNext(current, wanted)
if (problem !== null) refuse(problem)

await Bun.write(INSTANCE, withVersion(instance, wanted))
await Bun.write(APP, withAppVersion(await Bun.file(APP).text(), wanted))
await git`git commit --quiet --all --message ${`release: ${tag}`}`
await git`git tag --annotate ${tag} --message ${`cedo ${wanted}`}`
console.log(`Tagged ${tag}. Push both at once — main deploys, the tag builds the iPhone app:

    git push --atomic origin main ${tag}

Until the tag's iOS build has attached its files, an instance on ${tag} offers AltStore a source
that is not there yet; watch it under Actions → iOS app.`)
