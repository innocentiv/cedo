import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import { basename, dirname, join } from 'node:path'

/**
 * Every package this repository installs has a row in docs/dependencies.md, saying why it is here
 * and where it comes from. Exact pins and a frozen lockfile stop drift, and `minimumReleaseAge`
 * (bunfig.toml) refuses a version published days ago; neither stops a package whose name was
 * guessed — by an agent, or a tired human — and registered long ago by someone waiting for the
 * guess. Nothing offline can tell "the package I meant" from "a package with that name". A written
 * reason and repository, checked against what was installed, puts that question in front of
 * whoever adds it, and in front of the owner in the diff. See docs/02-conventions.md.
 */

/** Where a package is installed: a workspace by its folder name, `root`, or `override`. */
export type Installed = ReadonlyMap<string, ReadonlySet<string>>

export interface Row {
  readonly name: string
  readonly where: ReadonlySet<string>
  readonly why: string
  readonly upstream: string
}

const REGISTER = 'docs/dependencies.md'

/**
 * What is wrong between what is installed and what the register says, one sentence each.
 * `repositoryOf` reads the `repository` field of the installed package's own package.json.
 */
export function audit(
  installed: Installed,
  rows: readonly Row[],
  repositoryOf: (name: string) => unknown = () => null,
): string[] {
  const listed = new Map(rows.map((row) => [row.name, row]))
  const problems: string[] = []
  for (const [name, places] of installed) {
    const row = listed.get(name)
    if (row === undefined) {
      problems.push(missing(name, places))
      continue
    }
    if (sorted(row.where) !== sorted(places))
      problems.push(
        `${name} is installed in ${sorted(places)}, but its row in ${REGISTER} says ` +
          `${sorted(row.where)}: correct the Where column.`,
      )
    if (row.why.trim() === '')
      problems.push(`${name} has no reason in ${REGISTER}: say why this repository needs it.`)
    const named = repository(repositoryOf(name))
    if (named !== null && repository(row.upstream) !== named)
      problems.push(
        `${name}: its row in ${REGISTER} says ${row.upstream}, but the installed package names ` +
          `${named} as its repository. If that is not the project you meant, remove the package; ` +
          'if it is, correct the row.',
      )
  }
  for (const { name } of rows) {
    if (!installed.has(name))
      problems.push(
        `${REGISTER} has a row for ${name}, which no package.json installs: delete the row.`,
      )
  }
  return problems
}

const sorted = (places: ReadonlySet<string>): string => [...places].toSorted().join(', ')

/**
 * A package.json `repository` — a URL, `github:owner/repo`, `owner/repo`, or `{ url }` — as
 * `host/owner/repo`, lowercased; null when it names none.
 */
export function repository(field: unknown): string | null {
  const url = typeof field === 'object' && field !== null && 'url' in field ? field.url : field
  if (typeof url !== 'string' || url === '') return null
  const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+)\/([\w.-]+)$/u.exec(url)
  if (shorthand !== null) {
    const [, host = 'github', owner = '', repo = ''] = shorthand
    return `${host === 'bitbucket' ? 'bitbucket.org' : `${host}.com`}/${owner}/${repo}`.toLowerCase()
  }
  const long =
    /^(?:git\+)?(?:[a-z+]+:\/\/)?(?:git@)?([^/:]+)[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[/#].*)?$/u.exec(
      url,
    )
  if (long === null) return null
  const [, host = '', owner = '', repo = ''] = long
  return `${host}/${owner}/${repo}`.toLowerCase()
}

function missing(name: string, places: ReadonlySet<string>): string {
  return (
    `${name} (${[...places].join(', ')}) has no row in ${REGISTER}. Check it is the package ` +
    'you meant — its repository, its weekly downloads, the date it was first published — then ' +
    'add its row: why this repository needs it, and the repository it comes from.'
  )
}

const ROOT = join(import.meta.dir, '..')

type Manifest = Readonly<Record<string, unknown>>

const isManifest = (value: unknown): value is Manifest =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

async function readManifest(path: string): Promise<Manifest> {
  const json: unknown = await Bun.file(join(ROOT, path)).json()
  return isManifest(json) ? json : {}
}

/** A `dependencies`-shaped field's package names and specifiers. */
const specifiers = (field: unknown): [string, string][] =>
  isManifest(field)
    ? Object.entries(field).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      )
    : []

/** Every package.json's folder, `.` first, from the root's `workspaces` globs. */
async function manifests(): Promise<string[]> {
  const folders = ['.']
  const { workspaces } = await readManifest('package.json')
  const patterns = Array.isArray(workspaces) ? workspaces.filter((w) => typeof w === 'string') : []
  for (const pattern of patterns)
    for await (const file of new Glob(`${pattern}/package.json`).scan({ cwd: ROOT }))
      folders.push(dirname(file))
  return folders
}

/** What the package.json files install, and where. A `workspace:` package is ours, not installed. */
async function installedPackages(): Promise<Installed> {
  const installed = new Map<string, Set<string>>()
  const add = (name: string, place: string) =>
    installed.set(name, (installed.get(name) ?? new Set()).add(place))
  for (const folder of await manifests()) {
    const manifest = await readManifest(join(folder, 'package.json'))
    const place = folder === '.' ? 'root' : basename(folder)
    const specs = [
      ...specifiers(manifest['dependencies']),
      ...specifiers(manifest['devDependencies']),
      ...specifiers(manifest['optionalDependencies']),
    ]
    for (const [name, spec] of specs) if (!spec.startsWith('workspace:')) add(name, place)
    for (const [name] of specifiers(manifest['overrides'])) add(name, 'override')
  }
  return installed
}

/** The `repository` field of the package as installed, wherever Bun put it. */
async function installedRepositories(names: Iterable<string>): Promise<Map<string, unknown>> {
  const folders = await manifests()
  const found = new Map<string, unknown>()
  for (const name of names)
    for (const folder of folders) {
      const path = join(folder, 'node_modules', name, 'package.json')
      if (!(await Bun.file(join(ROOT, path)).exists())) continue
      found.set(name, (await readManifest(path))['repository'])
      break
    }
  return found
}

/** The register's table rows: | `name` | where, where | why | upstream |. */
export function parseRegister(markdown: string): Row[] {
  const rows: Row[] = []
  for (const line of markdown.split('\n')) {
    const cells = /^\|\s*`([^`]+)`\s*\|(.*)\|(.*)\|(.*)\|\s*$/u.exec(line)
    if (cells === null) continue
    const [, name = '', where = '', why = '', upstream = ''] = cells
    const link = /\]\(([^)]+)\)/u.exec(upstream)?.[1] ?? upstream.trim()
    rows.push({
      name,
      where: new Set(
        where
          .split(',')
          .map((place) => place.trim())
          .filter((p) => p !== ''),
      ),
      why: why.trim(),
      upstream: link,
    })
  }
  return rows
}

const row = (name: string, where: string[], upstream = `https://github.com/acme/${name}`): Row => ({
  name,
  where: new Set(where),
  why: 'Because.',
  upstream,
})

describe('the audit itself', () => {
  test('a package with no row is reported, with what to check before adding one', () => {
    const installed = new Map([
      ['zod', new Set(['contract'])],
      ['left-padder', new Set(['api', 'app'])],
    ])
    const problems = audit(installed, [row('zod', ['contract'])])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toStartWith('left-padder (api, app) has no row in docs/dependencies.md.')
    expect(problems[0]).toContain('its repository, its weekly downloads')
  })

  test('a row for a package nothing installs any more is reported', () => {
    const installed = new Map([['zod', new Set(['contract'])]])
    expect(audit(installed, [row('zod', ['contract']), row('moment', ['app'])])).toEqual([
      'docs/dependencies.md has a row for moment, which no package.json installs: delete the row.',
    ])
  })

  test('a row whose Where column disagrees with the package.json files is reported', () => {
    const installed = new Map([['zod', new Set(['api', 'contract'])]])
    expect(audit(installed, [row('zod', ['contract', 'app'])])).toEqual([
      'zod is installed in api, contract, but its row in docs/dependencies.md says app, contract: correct the Where column.',
    ])
  })

  test('a row with no reason is reported', () => {
    const installed = new Map([['zod', new Set(['contract'])]])
    expect(audit(installed, [{ ...row('zod', ['contract']), why: '' }])).toEqual([
      'zod has no reason in docs/dependencies.md: say why this repository needs it.',
    ])
  })

  test('an upstream that is not the repository the installed package names is reported', () => {
    const installed = new Map([['zod', new Set(['contract'])]])
    const rows = [row('zod', ['contract'], 'https://github.com/zod-fans/zod')]
    expect(audit(installed, rows, () => 'git+https://github.com/colinhacks/zod.git')).toEqual([
      'zod: its row in docs/dependencies.md says https://github.com/zod-fans/zod, but the installed ' +
        'package names github.com/colinhacks/zod as its repository. If that is not the project you ' +
        'meant, remove the package; if it is, correct the row.',
    ])
  })
})

describe('repository', () => {
  test('reads every form a package.json writes its repository in', () => {
    expect(repository('git+https://github.com/colinhacks/zod.git')).toBe(
      'github.com/colinhacks/zod',
    )
    expect(
      repository({ type: 'git', url: 'https://github.com/expo/expo.git', directory: 'x' }),
    ).toBe('github.com/expo/expo')
    expect(repository('github:oxc-project/tsgolint')).toBe('github.com/oxc-project/tsgolint')
    expect(repository('porsager/postgres')).toBe('github.com/porsager/postgres')
    expect(repository('git+ssh://git@github.com/Acme/Thing.git')).toBe('github.com/acme/thing')
    expect(repository('https://github.com/elysiajs/elysia')).toBe('github.com/elysiajs/elysia')
  })

  test('a package that names no repository reads as null', () => {
    expect(repository(null)).toBeNull()
    expect(repository({ type: 'git' })).toBeNull()
  })
})

describe('parseRegister', () => {
  test('reads a row, its places, and the link in its upstream cell', () => {
    const markdown = [
      '| Package | Where | Why | Upstream |',
      '| --- | --- | --- | --- |',
      '| `zod` | contract, api | One schema per shape. | [colinhacks/zod](https://github.com/colinhacks/zod) |',
    ].join('\n')
    expect(parseRegister(markdown)).toEqual([
      {
        name: 'zod',
        where: new Set(['contract', 'api']),
        why: 'One schema per shape.',
        upstream: 'https://github.com/colinhacks/zod',
      },
    ])
  })
})

describe('the register matches what this repository installs', () => {
  test('the scan reaches every workspace, the overrides, and leaves our own packages out', async () => {
    // A scan that silently read nothing would pass the check below.
    const installed = await installedPackages()
    expect(installed.get('zod')).toEqual(new Set(['contract', 'api', 'app']))
    expect(installed.get('oxlint')).toEqual(new Set(['root']))
    expect(installed.get('react-native-worklets')).toEqual(new Set(['app', 'override']))
    expect(installed.has('@cedo/contract')).toBe(false)
  })

  test('every package has a correct row, and every row a package', async () => {
    const installed = await installedPackages()
    const register = Bun.file(join(ROOT, REGISTER))
    const rows = (await register.exists()) ? parseRegister(await register.text()) : []
    const repositories = await installedRepositories(installed.keys())
    expect(audit(installed, rows, (name) => repositories.get(name))).toEqual([])
  })
})
