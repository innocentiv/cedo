/**
 * The gate's coverage check, run by `bun run test` after the suite: reads the lcov Bun wrote, and
 * fails on any measured file under the rule in `coverage-rule.ts`, naming it and what to do.
 *
 * Bun's own `coverageThreshold` is not used. A run under it exits 1 with no message while its
 * summary says "0 fail", and a file no test imports is left out of its report instead of counting
 * as none (#83). See docs/10-testing.md, "Coverage".
 */
import { Glob } from 'bun'
import { join, resolve } from 'node:path'
import { FLOOR, judge, parseBaseline, parseLcov, plainModules } from './coverage-rule.ts'

const ROOT = resolve(import.meta.dir, '..')
const LCOV = '.artifacts/coverage/lcov.info'

/** What invariant 7 says is tested on the backend; the app's plain modules come from the invariant. */
const MEASURED = ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts']

/** Left out of what is measured, each for its reason. */
const LEFT_OUT: readonly (readonly [RegExp, string])[] = [
  [/\.(?:test|probe|perf)\.ts$/u, 'tests, and the fixtures they spawn'],
  [/^apps\/api\/src\/test\//u, 'the test and perf harness'],
  [
    /^apps\/api\/src\/db\/tables\//u,
    'table definitions: their only functions are index callbacks, which drizzle-kit runs; the ' +
      'migrations and the perf guards check those indexes',
  ],
  [/^apps\/api\/src\/index\.ts$/u, 'boots the server, which the e2e journeys run'],
  [
    /^apps\/api\/src\/db\/(?:prepare-test-db|curate-for-test|ensure)\.ts$/u,
    "the test database's tooling",
  ],
  [/^apps\/api\/src\/db\/seed-perf\//u, "the perf suite's own 250k-row seed, run by `perf:seed`"],
]

const RULE = 'See docs/10-testing.md, "Coverage".'

function fail(lines: readonly string[]): never {
  for (const line of lines) console.error(line)
  process.exit(1)
}

const lcov = Bun.file(join(ROOT, LCOV))
if (!(await lcov.exists()))
  fail([`No ${LCOV}. It is written by \`bun run test\`, which runs this after the suite. ${RULE}`])

const measured = new Set<string>()
for (const pattern of MEASURED)
  for (const file of new Glob(pattern).scanSync({ cwd: ROOT }))
    if (!LEFT_OUT.some(([excluded]) => excluded.test(file))) measured.add(file)

const modules = plainModules(await Bun.file(join(ROOT, 'CLAUDE.md')).text())
const present = await Promise.all(
  modules.map(async (file) => await Bun.file(join(ROOT, file)).exists()),
)
const missing: string[] = []
for (const [i, file] of modules.entries()) {
  if (present[i] === true) measured.add(file)
  else
    missing.push(`CLAUDE.md, invariant 7, names ${file}, which does not exist: correct it. ${RULE}`)
}

const baseline = parseBaseline(await Bun.file(join(ROOT, 'test/coverage-baseline.json')).json())
const problems = [
  ...missing,
  ...judge([...measured].toSorted(), parseLcov(await lcov.text(), ROOT), baseline),
]
if (problems.length > 0)
  fail([...problems, '', `${String(problems.length)} coverage problem(s). ${LCOV} has the detail.`])

const kept = Object.keys(baseline).length
console.log(
  `Coverage: ${String(measured.size)} files, each with ${String(FLOOR)}% of lines and functions ` +
    `run by a test, or ${String(kept)} at their baseline.`,
)
