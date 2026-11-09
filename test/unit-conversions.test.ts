import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import { join } from 'node:path'

/**
 * Invariant 6: a unit converts in `packages/contract/src/units.ts` and nowhere else — weight,
 * distance and time alike. A `/ 1000` typechecks whether it turns grams into kilograms or
 * milliseconds into seconds, and a reviewer cannot tell which from the line. This scans the
 * source for a conversion factor beside `*`, `/` or `%` and fails on one outside that file.
 * Tests are not scanned: a test states its expected values without the code under test.
 * See docs/02-conventions.md, "Units".
 */

const ROOT = join(import.meta.dir, '..')
const UNITS = 'packages/contract/src/units.ts'

/** Where source lives. A new workspace under `packages/` is scanned without a change here. */
const SOURCE = [
  'packages/*/src/**/*.{ts,tsx}',
  'apps/api/{src,scripts}/**/*.ts',
  'apps/api/*.ts',
  'apps/app/{app,src,scripts,modules}/**/*.{ts,tsx}',
  'apps/app/*.{ts,tsx}',
  'scripts/**/*.ts',
]

/** Tests and the tooling only tests run. */
const NOT_SCANNED = [
  /\.test\.tsx?$/u,
  /\.perf\.ts$/u,
  /^apps\/api\/src\/test\//u,
  /^apps\/app\/e2e\//u,
]

/** Seconds, milliseconds, pounds and miles, each with the slack its usual spelling needs. */
const FACTORS: readonly { value: number; slack: number }[] = [
  { value: 60, slack: 0 },
  { value: 1000, slack: 0 },
  { value: 3600, slack: 0 },
  { value: 86_400, slack: 0 },
  { value: 60_000, slack: 0 },
  { value: 3_600_000, slack: 0 },
  { value: 86_400_000, slack: 0 },
  { value: 453.592_37, slack: 0.01 },
  { value: 0.453_592_37, slack: 0.001 },
  { value: 2.204_62, slack: 0.01 },
  { value: 1609.344, slack: 0.01 },
  { value: 1.609_344, slack: 0.001 },
]

const isFactor = (literal: string): boolean => {
  const value = Number(literal.replaceAll('_', ''))
  return FACTORS.some((factor) => Math.abs(value - factor.value) <= factor.slack)
}

/** A character that, before a `/`, means the slash opens a regular expression, not a division. */
const BEFORE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n'])

/**
 * The source with every comment, string and regular expression blanked to spaces — newlines kept,
 * so a line number still points at the line — and the code inside `${…}` left in place.
 */
export function codeOnly(source: string): string {
  let out = ''
  let i = 0
  const blank = (text: string) => text.replaceAll(/[^\n]/gu, ' ')
  const lastCode = () => out.trimEnd().at(-1) ?? ''
  const templates: number[] = [] // brace depth at which each open `${` returns to its template

  while (i < source.length) {
    const ch = source[i] ?? ''
    const next = source[i + 1] ?? ''
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      out += blank(source.slice(i, stop))
      i = stop
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      out += blank(source.slice(i, stop))
      i = stop
    } else if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < source.length && source[j] !== ch && source[j] !== '\n')
        j += source[j] === '\\' ? 2 : 1
      out += blank(source.slice(i, j + 1))
      i = j + 1
    } else if (ch === '`' || (ch === '}' && templates.at(-1) === 0)) {
      // A template's text, from its opening backtick or the `}` that closes an expression.
      if (ch === '}') templates.pop()
      let j = i + 1
      while (j < source.length && source[j] !== '`' && !source.startsWith('${', j))
        j += source[j] === '\\' ? 2 : 1
      if (source.startsWith('${', j)) {
        templates.push(0)
        out += blank(source.slice(i, j + 2))
        i = j + 2
      } else {
        out += blank(source.slice(i, j + 1))
        i = j + 1
      }
    } else if (ch === '/' && BEFORE_REGEX.has(lastCode())) {
      let j = i + 1
      let inClass = false
      while (j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '[') inClass = true
        if (source[j] === ']') inClass = false
        j += source[j] === '\\' ? 2 : 1
      }
      out += blank(source.slice(i, j + 1))
      i = j + 1
    } else {
      if (templates.length > 0 && ch === '{') templates.push((templates.pop() ?? 0) + 1)
      if (templates.length > 0 && ch === '}') templates.push((templates.pop() ?? 1) - 1)
      out += ch
      i += 1
    }
  }
  return out
}

/** Each line with a conversion factor beside `*`, `/` or `%` in its code, as `line: text`. */
export function conversions(source: string): string[] {
  const code = codeOnly(source)
  const lines = new Set<number>()
  const number = /(?<![\w.])\d[\d_]*(?:\.\d[\d_]*)?(?![\w.])/gu
  for (const match of code.matchAll(number)) {
    if (!isFactor(match[0])) continue
    const before = code.slice(0, match.index).trimEnd()
    const after = code.slice(match.index + match[0].length).trimStart()
    if (/[*/%]=?$/u.test(before) || /^[*/%]/u.test(after))
      lines.add(code.slice(0, match.index).split('\n').length)
  }
  const text = source.split('\n')
  return [...lines].map((line) => `${String(line)}: ${(text[line - 1] ?? '').trim()}`)
}

describe('the scan itself', () => {
  test('finds a factor on either side of the operator, and in compound assignment', () => {
    const source = [
      'const kg = grams / 1000',
      'const ms = 1000 * seconds',
      'const window = 15 * 60',
      'elapsed %= 3600',
      'const lb = g / 453.592_37',
      'const day = 24 * 60 * 60 * 1000',
    ].join('\n')
    // One line, however many factors are on it.
    expect(conversions(source).map((hit) => hit.split(':')[0])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
  })

  test('reads past comments, strings and regular expressions, and into template expressions', () => {
    const source = [
      '// grams / 1000 is kilograms',
      "const label = 'per 60 / 1000'",
      'const pattern = /\\d+ \\/ 60/u',
      '/* 1000 * x */ const fine = 60',
      'const text = `${total / 60} min, of 60 * 1000`',
    ].join('\n')
    expect(conversions(source)).toEqual(['5: const text = `${total / 60} min, of 60 * 1000`'])
  })

  test('leaves a factor no operator touches, and numbers that only look alike', () => {
    const source = [
      'const LIMIT = 1000',
      'if (seconds > 60) return',
      'const half = x / 2',
      'const id = 61000 * 2',
      'const scale = 1.5 * 100',
    ].join('\n')
    expect(conversions(source)).toEqual([])
  })
})

describe('no unit converts outside units.ts', () => {
  const files: string[] = []
  for (const pattern of SOURCE)
    for (const file of new Glob(pattern).scanSync({ cwd: ROOT }))
      if (file !== UNITS && !NOT_SCANNED.some((excluded) => excluded.test(file))) files.push(file)

  test('the scan reaches the source it guards, and not the tests', () => {
    // A glob that silently matched nothing would pass the check below.
    expect(files).toContain('packages/contract/src/rest.ts')
    expect(files).toContain('apps/api/src/modules/auth/service.ts')
    expect(files).toContain('apps/app/src/lib/rest-alert.ts')
    expect(files).toContain('apps/app/app/_layout.tsx')
    expect(files).toContain('apps/app/scripts/chime-wav.ts')
    expect(files).toContain('scripts/release.ts')
    expect(files).not.toContain(UNITS)
    expect(files).not.toContain('packages/contract/src/rest.test.ts')
  })

  test('every file', async () => {
    const offences: string[] = []
    for (const file of files) {
      for (const hit of conversions(await Bun.file(join(ROOT, file)).text()))
        offences.push(
          `${file}:${hit} — a unit conversion outside ${UNITS}. Use, or add, a helper there: ` +
            'weight, distance and time convert in that one file (invariant 6). If the number is ' +
            'no unit at all — tenths of a percent, a count — name it as a constant, which says ' +
            'what it is and is not read as a factor.',
        )
    }
    expect(offences).toEqual([])
  })
})
