import { describe, expect, test } from 'bun:test'
import { judge, parseBaseline, parseLcov, plainModules } from './coverage-rule.ts'

const ROOT = '/repo'

/** One lcov record, as `bun test --coverage --coverage-reporter=lcov` writes it. */
const record = (file: string, lines: [number, number], functions: [number, number]): string =>
  [
    `SF:${ROOT}/${file}`,
    `FNF:${String(functions[0])}`,
    `FNH:${String(functions[1])}`,
    'DA:1,1',
    `LF:${String(lines[0])}`,
    `LH:${String(lines[1])}`,
    'end_of_record',
  ].join('\n')

describe('parseLcov', () => {
  test('reads each file as percentages of lines and functions, floored to a tenth', () => {
    const lcov = [
      record('apps/api/src/a.ts', [40, 39], [10, 9]),
      record('apps/api/src/b.ts', [3, 2], [3, 1]),
    ].join('\n')
    expect(parseLcov(lcov, ROOT)).toEqual(
      new Map([
        ['apps/api/src/a.ts', { lines: 97.5, functions: 90 }],
        ['apps/api/src/b.ts', { lines: 66.6, functions: 33.3 }],
      ]),
    )
  })

  test('a file with no functions, or no lines, is fully covered on that count', () => {
    const lcov = record('packages/contract/src/c.ts', [12, 12], [0, 0])
    expect(parseLcov(lcov, ROOT).get('packages/contract/src/c.ts')).toEqual({
      lines: 100,
      functions: 100,
    })
  })
})

describe('judge', () => {
  const full = { lines: 100, functions: 100 }

  test('every measured file at 90 / 90 or over passes', () => {
    const report = new Map([['a.ts', { lines: 90, functions: 97.5 }]])
    expect(judge(['a.ts'], report, {})).toEqual([])
  })

  test('a file under the floor fails, saying by how much and where the rule is', () => {
    const report = new Map([['a.ts', { lines: 88.2, functions: 100 }]])
    expect(judge(['a.ts'], report, {})).toEqual([
      'a.ts: 88.2% of lines and 100% of functions are run by a test; every file needs 90% of ' +
        'each. Test what it does, or delete what nothing needs. See docs/10-testing.md, "Coverage".',
    ])
  })

  test('a measured file no test loads counts as none covered — it is not invisible', () => {
    expect(judge(['a.ts', 'b.ts'], new Map([['a.ts', full]]), {})).toEqual([
      'b.ts: no test runs any of it. Every file here needs a test that does: write one beside ' +
        'it. See docs/10-testing.md, "Coverage".',
    ])
  })

  test('a file the report has but the rule does not measure is left alone', () => {
    const report = new Map([
      ['a.ts', full],
      ['apps/app/src/ui/screen.ts', { lines: 10, functions: 10 }],
    ])
    expect(judge(['a.ts'], report, {})).toEqual([])
  })

  describe('a baselined file', () => {
    const baseline = { 'env.ts': { lines: 81.6, functions: 83.3, reason: 'Reads the process.' } }

    test('passes at its baseline, under the floor', () => {
      const report = new Map([['env.ts', { lines: 81.6, functions: 83.3 }]])
      expect(judge(['env.ts'], report, baseline)).toEqual([])
    })

    test('fails below its baseline: coverage there only goes up', () => {
      const report = new Map([['env.ts', { lines: 75, functions: 83.3 }]])
      expect(judge(['env.ts'], report, baseline)).toEqual([
        'env.ts: 75% of lines and 83.3% of functions, under its baseline of 81.6% and 83.3% in ' +
          'test/coverage-baseline.json. A baselined file only goes up: test what you added.',
      ])
    })

    test('fails above its baseline, until the baseline is raised to match', () => {
      const report = new Map([['env.ts', { lines: 85, functions: 83.3 }]])
      expect(judge(['env.ts'], report, baseline)).toEqual([
        'env.ts: now 85% of lines and 83.3% of functions. Raise its entry in ' +
          'test/coverage-baseline.json to match, so it cannot fall back.',
      ])
    })

    test('fails once it reaches the floor, until its entry is deleted', () => {
      const report = new Map([['env.ts', { lines: 92, functions: 90 }]])
      expect(judge(['env.ts'], report, baseline)).toEqual([
        'env.ts: now at 90% of lines and functions or over. Delete its entry from ' +
          'test/coverage-baseline.json: the floor holds it from here.',
      ])
    })

    test('an entry for a file that is not measured fails, until it is deleted', () => {
      expect(judge([], new Map(), baseline)).toEqual([
        'test/coverage-baseline.json lists env.ts, which is not measured: delete its entry.',
      ])
    })
  })
})

describe('parseBaseline', () => {
  test('reads each entry with its numbers and its reason', () => {
    const json = { 'env.ts': { lines: 81.6, functions: 83.3, reason: 'Reads the process.' } }
    expect(parseBaseline(json)).toEqual(json)
  })

  test('an entry with no reason, or no numbers, is an error naming it', () => {
    expect(() => parseBaseline({ 'env.ts': { lines: 81.6, functions: 83.3 } })).toThrow('env.ts')
    expect(() => parseBaseline({ 'env.ts': { reason: 'Why.' } })).toThrow('env.ts')
    expect(() => parseBaseline([])).toThrow('test/coverage-baseline.json')
  })
})

describe('plainModules', () => {
  test("reads the app's plain modules from invariant 7, and only from it", () => {
    const claude = [
      '6. **All measurements** … `apps/app/src/not-this.ts` …',
      '7. **All behaviour is tested on the backend.** … in plain modules',
      '   (`apps/app/src/auth/session.ts`, `apps/app/src/api/retry.ts`;',
      '   no React) — as is what the engine lacks (`apps/app/src/lib/hermes-builtins.ts`).',
      '8. **Every package** … `apps/app/src/nor-this.ts`',
      '',
      '## Public repository',
    ].join('\n')
    expect(plainModules(claude)).toEqual([
      'apps/app/src/auth/session.ts',
      'apps/app/src/api/retry.ts',
      'apps/app/src/lib/hermes-builtins.ts',
    ])
  })

  test('an invariant 7 that names no module is an error, not an empty list', () => {
    expect(() => plainModules('7. **All behaviour is tested.**\n8. next')).toThrow('invariant 7')
  })
})
