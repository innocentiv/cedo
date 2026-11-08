/**
 * `bun run release <version>` — cuts a release (#79, ADR-0032), from a clean `main`: sets `VERSION`
 * in the contract and the app's `version` and `ios.buildNumber` in one commit, and tags it
 * `v<version>`. Nothing is pushed: `git push origin main v<version>` is left to whoever cut it,
 * since it deploys `main` and builds the iPhone app on the tag (.github/workflows/ios.yml).
 *
 * `0.x` while AltStore is the only way the app is installed: a minor when the contract changes, a
 * patch otherwise. What it writes is `release-files.ts`, tested on its own.
 */
import { $ } from 'bun'
import { checkVersion, withAppVersion, withVersion } from './release-files.ts'

const ROOT = new URL('../', import.meta.url).pathname
const INSTANCE = `${ROOT}packages/contract/src/instance.ts`
const APP = `${ROOT}apps/app/app.json`

function refuse(reason: string): never {
  console.error(reason)
  process.exit(1)
}

const wanted = Bun.argv[2]
if (wanted === undefined) refuse('Which version? bun run release 0.1.0')

if ((await $`git status --porcelain`.cwd(ROOT).text()).trim() !== '') {
  refuse('The working tree has changes: commit or stash them first.')
}
const branch = (await $`git branch --show-current`.cwd(ROOT).text()).trim()
if (branch !== 'main') refuse(`Releases are cut from main; this is ${branch}.`)

const instance = await Bun.file(INSTANCE).text()
const current = /^export const VERSION = '([^']*)'$/mu.exec(instance)?.[1]
if (current === undefined) refuse(`No VERSION in ${INSTANCE}.`)
const problem = checkVersion(current, wanted)
if (problem !== null) refuse(problem)

await Bun.write(INSTANCE, withVersion(instance, wanted))
await Bun.write(APP, withAppVersion(await Bun.file(APP).text(), wanted))

const tag = `v${wanted}`
await $`git commit --quiet --all --message ${`release: ${tag}`}`.cwd(ROOT)
await $`git tag --annotate ${tag} --message ${`cedo ${wanted}`}`.cwd(ROOT)
console.log(`Tagged ${tag}. Push it, which deploys main and builds the iPhone app:

    git push origin main ${tag}`)
