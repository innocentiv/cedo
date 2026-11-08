/**
 * What the native app's JavaScript engine lacks, given before anything else runs (#77).
 *
 * React Native runs on Hermes, which has nearly every built-in Bun and the browsers have — but not
 * `Array.prototype.toSorted`, which the contract uses: the exercise picker threw "undefined is not
 * a function" as it drew its first row. Bun, which runs the API and every test, and every browser
 * have it, so only a native run could show it. Evaluated first by `index.ts`, the app's entry, so
 * no module runs before it; where the engine has its own, it changes nothing.
 *
 * Hermes also lacks `Array.fromAsync`, `Intl.PluralRules`, `Intl.ListFormat`,
 * `Intl.RelativeTimeFormat`, `Intl.Segmenter`, `Intl.DateTimeFormat#formatRange` and the RegExp `v`
 * flag, and formats a unit with `Intl.NumberFormat` wrongly — 2 kg as "4.409#". Nothing uses them,
 * and `hermes-builtins.test.ts` fails on the first use of any of them in the app or the contract.
 */

/** What ES2023's `toSorted` gives: a sorted copy, the array itself untouched. */
export function sortedCopy<T>(array: ArrayLike<T>, compare?: (a: T, b: T) => number): T[] {
  if (compare !== undefined && typeof compare !== 'function') {
    throw new TypeError('The comparison function must be either a function or undefined')
  }
  // A copy of its own is what `toSorted` is: sorting it in place touches nothing else.
  // oxlint-disable-next-line unicorn/no-array-sort
  return Array.from(array).sort(compare)
}

/** The method itself, called on an array. */
function toSorted<T>(this: ArrayLike<T>, compare?: (a: T, b: T) => number): T[] {
  return sortedCopy(this, compare)
}

/** Gives `prototype` a `toSorted` when it has none; one it has is left alone. */
export function giveMissing(prototype: object): void {
  if ('toSorted' in prototype) return
  Object.defineProperty(prototype, 'toSorted', {
    value: toSorted,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

giveMissing(Array.prototype)
