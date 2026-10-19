import { formatDuration } from './units.ts'

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

/**
 * A duration, typed on a number pad — which has no `:` key. So, as on a timer, the last two digits
 * are seconds, the two before them minutes, the rest hours: `90` is 90 s, `130` is 1:30, `2500` is
 * 25:00, `10205` is 1:02:05. The field shows the clock as it grows, and a separator someone types
 * anyway is ignored, so `1:30` and `130` are the same keys. Seconds past 59 are taken as typed —
 * `190` is 2:30 — and shown as a clock once the field is left.
 */
export const CLOCK: Typing = {
  decimals: false,
  toText: (value) => (value === null ? '' : formatDuration(value)),
  parse: (text) => {
    // At most one leading zero survives: "0" stays on screen, "045" is 45.
    const digits = text.replaceAll(/\D/gu, '').replace(/^0+(?=\d)/u, '')
    if (digits === '') return { text: '', value: null }
    const seconds = Number(digits.slice(-2))
    const minutes = Number(digits.slice(-4, -2) || '0')
    const hours = Number(digits.slice(0, -4) || '0')
    const value = hours * 3600 + minutes * 60 + seconds
    if (!Number.isFinite(value)) return { text: digits, value: null }
    return { text: clockText(digits), value }
  },
}

/** `"5"` → `"5"`, `"130"` → `"1:30"`, `"10205"` → `"1:02:05"`: the digits, grouped as typed. */
function clockText(digits: string): string {
  if (digits.length <= 2) return digits
  const seconds = digits.slice(-2)
  if (digits.length <= 4) return `${digits.slice(0, -2)}:${seconds}`
  return `${digits.slice(0, -4)}:${digits.slice(-4, -2)}:${seconds}`
}
