/**
 * How a number is TYPED into a field: what text a value shows as, and what typed text means. A
 * measured dimension has one (`DIMENSION_FIELDS`), and so does a plain count (`COUNT`); the app's one
 * typing mechanic takes either. See docs/08-frontend.md.
 */

/** What a field shows while it is being typed in, and the value that text means. */
export interface Typed {
  readonly text: string
  /** In the field's stored unit — base units for a dimension, the number itself for a count. */
  readonly value: number | null
}

export interface Typing {
  readonly decimals: boolean
  readonly toText: (value: number | null) => string
  readonly parse: (text: string) => Typed
}

/**
 * Keeps what was typed: digits, plus — with `decimals` — ONE separator, normalised to a point. A
 * comma is the decimal key on an Italian, German or French keypad, and stripping it turned "62,5"
 * into 625.
 */
function cleanNumber(text: string, decimals: boolean): string {
  if (!decimals) return text.replaceAll(/\D/gu, '')
  const [whole = '', ...rest] = text
    .replaceAll(',', '.')
    .replaceAll(/[^\d.]/gu, '')
    .split('.')
  return rest.length === 0 ? whole : `${whole}.${rest.join('')}`
}

/**
 * The text is returned as well as the value: "62." must stay "62." on screen while it parses to 62,
 * or the point vanishes under the cursor and 62.5 typed key by key becomes 625.
 *
 * A number too long to be finite is no value, not `Infinity`: `JSON.stringify(Infinity)` is
 * `null`, so it would reach the API as a silently empty field.
 */
export function typing(
  decimals: boolean,
  toStored: (typed: number) => number,
  fromStored: (stored: number) => number,
): Typing {
  return {
    decimals,
    toText: (value) => (value === null ? '' : String(fromStored(value))),
    parse: (text) => {
      const cleaned = cleanNumber(text, decimals)
      const typed = Number(cleaned)
      if (cleaned === '' || cleaned === '.' || !Number.isFinite(typed)) {
        return { text: cleaned, value: null }
      }
      return { text: cleaned, value: toStored(typed) }
    },
  }
}

const identity = (n: number): number => n

/** A plain count — sets, a rep range, a percentage: whole numbers, stored as typed. */
export const COUNT: Typing = typing(false, identity, identity)
