import { describe, expect, test } from 'bun:test'
import { giveMissing, sortedCopy } from './hermes-builtins.ts'

describe('toSorted, for an engine without it', () => {
  test('is a sorted copy, and leaves the array as it was', () => {
    const array = [3, 1, 2]
    expect(sortedCopy(array, (a, b) => a - b)).toEqual([1, 2, 3])
    expect(array).toEqual([3, 1, 2])
  })

  test('sorts as strings with no comparison, as sort does', () => {
    expect(sortedCopy([10, 9, 1])).toEqual([1, 10, 9])
  })

  test('refuses a comparison that is not a function', () => {
    expect(() => sortedCopy([1], 'up' as never)).toThrow(TypeError)
  })

  test('is given to a prototype without one, as a method, unlisted', () => {
    const bare: object = {}
    giveMissing(bare)
    const method: unknown = Reflect.get(bare, 'toSorted')
    if (typeof method !== 'function') throw new Error('toSorted was not given')
    expect(Reflect.apply(method, [3, 1, 2], [(a: number, b: number) => a - b])).toEqual([1, 2, 3])
    expect(Object.keys(bare)).toEqual([])
  })

  test('is not given over one the engine has', () => {
    const own = (): string => 'its own'
    const has = { toSorted: own }
    giveMissing(has)
    expect(has.toSorted).toBe(own)
  })
})

/**
 * Built-ins Hermes lacks, measured on the iOS simulator (#77). Bun and the browsers have them all,
 * so no other test can see a use of one; the native app would throw, or say a wrong thing, there.
 */
const MISSING_ON_HERMES: readonly (readonly [RegExp, string])[] = [
  [/\bArray\.fromAsync\b/u, 'Array.fromAsync'],
  [/\bIntl\.(?:PluralRules|ListFormat|RelativeTimeFormat|Segmenter)\b/u, 'that Intl constructor'],
  [/\.formatRange\(/u, 'Intl.DateTimeFormat#formatRange'],
  [/style:\s*'unit'/u, "Intl.NumberFormat's unit style, which Hermes gets wrong"],
]

const ROOT = new URL('../../../../', import.meta.url).pathname
const SOURCES = [
  'packages/contract/src/**/*.ts',
  'apps/app/src/**/*.{ts,tsx}',
  'apps/app/app/**/*.tsx',
]

describe('the app and the contract', () => {
  test('use no built-in that Hermes lacks', async () => {
    const uses: string[] = []
    for (const pattern of SOURCES) {
      for (const file of new Bun.Glob(pattern).scanSync({ cwd: ROOT })) {
        if (file.endsWith('.test.ts') || file.endsWith('hermes-builtins.ts')) continue
        // oxlint-disable-next-line no-await-in-loop -- a handful of small files, read in turn.
        const text = await Bun.file(`${ROOT}${file}`).text()
        for (const [missing, name] of MISSING_ON_HERMES) {
          if (missing.test(text)) uses.push(`${file}: ${name}`)
        }
      }
    }
    expect(uses).toEqual([])
  })
})
