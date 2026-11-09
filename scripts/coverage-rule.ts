/**
 * The coverage rule `scripts/coverage.ts` holds the gate to (#83), as pure functions: every measured
 * file has 90% of its lines and 90% of its functions run by a test; a file no test loads counts as
 * none, not as absent; a file under the floor for a stated reason sits in
 * `test/coverage-baseline.json` at its own numbers, which only go up. See docs/10-testing.md,
 * "Coverage".
 */

/** Percentages, floored to a tenth: 39 of 40 lines is 97.5, 2 of 3 is 66.6. */
export interface Coverage {
  readonly lines: number
  readonly functions: number
}

/** A file kept under the floor: its numbers, which only go up, and why. */
export interface BaselineEntry extends Coverage {
  readonly reason: string
}

export type Baseline = Readonly<Record<string, BaselineEntry>>

export const FLOOR = 90
const BASELINE = 'test/coverage-baseline.json'
const RULE = 'See docs/10-testing.md, "Coverage".'

/** Counted in tenths of a percent, so the floor is exact: integers until the last division. */
const TENTHS_PER_WHOLE = 1000
const TENTHS_PER_PERCENT = 10

const percent = (hit: number, found: number): number =>
  found === 0 ? 100 : Math.floor((hit * TENTHS_PER_WHOLE) / found) / TENTHS_PER_PERCENT

/** `lcov.info` as Bun writes it, by path relative to `root`. */
export function parseLcov(text: string, root: string): Map<string, Coverage> {
  const files = new Map<string, Coverage>()
  let file = ''
  const counts = { LF: 0, LH: 0, FNF: 0, FNH: 0 }
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      file = line.slice(3).replace(`${root}/`, '')
      counts.LF = counts.LH = counts.FNF = counts.FNH = 0
    } else if (line === 'end_of_record') {
      files.set(file, {
        lines: percent(counts.LH, counts.LF),
        functions: percent(counts.FNH, counts.FNF),
      })
    } else {
      const [key = '', value = ''] = line.split(':')
      if (key === 'LF' || key === 'LH' || key === 'FNF' || key === 'FNH')
        counts[key] = Number(value)
    }
  }
  return files
}

/** What is wrong with the measured files' coverage, one sentence each, for whoever reads the gate. */
export function judge(
  measured: readonly string[],
  report: ReadonlyMap<string, Coverage>,
  baseline: Baseline,
): string[] {
  const problems: string[] = []
  for (const file of measured) {
    const got = report.get(file)
    if (got === undefined) {
      problems.push(
        `${file}: no test runs any of it. Every file here needs a test that does: write one ` +
          `beside it. ${RULE}`,
      )
      continue
    }
    const kept = baseline[file]
    const over = got.lines >= FLOOR && got.functions >= FLOOR
    const numbers = `${String(got.lines)}% of lines and ${String(got.functions)}% of functions`
    if (kept === undefined) {
      if (!over)
        problems.push(
          `${file}: ${numbers} are run by a test; every file needs ${String(FLOOR)}% of each. ` +
            `Test what it does, or delete what nothing needs. ${RULE}`,
        )
    } else if (over) {
      problems.push(
        `${file}: now at ${String(FLOOR)}% of lines and functions or over. Delete its entry from ` +
          `${BASELINE}: the floor holds it from here. ${RULE}`,
      )
    } else if (got.lines < kept.lines || got.functions < kept.functions) {
      problems.push(
        `${file}: ${numbers}, under its baseline of ${String(kept.lines)}% and ` +
          `${String(kept.functions)}% in ${BASELINE}. A baselined file only goes up: test what ` +
          `you added. ${RULE}`,
      )
    } else if (got.lines > kept.lines || got.functions > kept.functions) {
      problems.push(
        `${file}: now ${numbers}. Raise its entry in ${BASELINE} to match, so it cannot fall ` +
          `back. ${RULE}`,
      )
    }
  }
  const listed = new Set(measured)
  for (const file of Object.keys(baseline))
    if (!listed.has(file))
      problems.push(`${BASELINE} lists ${file}, which is not measured: delete its entry. ${RULE}`)
  return problems
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `test/coverage-baseline.json`, checked: every entry has both numbers and a reason. */
export function parseBaseline(json: unknown): Baseline {
  if (!isRecord(json)) throw new Error(`${BASELINE} must be an object of file → entry. ${RULE}`)
  const baseline: Record<string, BaselineEntry> = {}
  for (const [file, entry] of Object.entries(json)) {
    if (
      !isRecord(entry) ||
      typeof entry['lines'] !== 'number' ||
      typeof entry['functions'] !== 'number' ||
      typeof entry['reason'] !== 'string' ||
      entry['reason'].trim() === ''
    )
      throw new Error(
        `${BASELINE}: ${file} needs { "lines": n, "functions": n, "reason": "why it stays under ` +
          `${String(FLOOR)}%" }. ${RULE}`,
      )
    baseline[file] = {
      lines: entry['lines'],
      functions: entry['functions'],
      reason: entry['reason'],
    }
  }
  return baseline
}

/**
 * The app's plain modules — the state only the app owns, unit-tested beside it — as CLAUDE.md's
 * invariant 7 names them. Read from there so the list is written once: name a new one in the
 * invariant and it is measured.
 */
export function plainModules(claudeMd: string): string[] {
  const start = claudeMd.search(/^7\. /mu)
  const rest = start === -1 ? '' : claudeMd.slice(start)
  const end = rest.search(/^(?:8\. |## )/mu)
  const invariant = end === -1 ? rest : rest.slice(0, end)
  const modules = [...invariant.matchAll(/`(apps\/app\/src\/[^`]+\.ts)`/gu)].map((m) => m[1] ?? '')
  if (modules.length === 0)
    throw new Error(
      "Could not read the app's plain modules from CLAUDE.md, invariant 7: it should name each as " +
        `\`apps/app/src/….ts\`. ${RULE}`,
    )
  return modules
}
