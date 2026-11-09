import { clockToS, formatDuration } from './units.ts'

/**
 * How a number is TYPED into a field: what text a value shows as, and what typed text means. A
 * measured dimension has one (`DIMENSION_FIELDS`), a plain count has `COUNT`, and a duration has
 * `CLOCK`; the app's one typing mechanic takes any of them. See docs/08-frontend.md.
 */

/** What a field shows while it is being typed in, and the value that text means. */
interface Typed {
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
    // `Number('')` is 0, so a group not typed yet counts as none.
    const value = clockToS(
      Number(digits.slice(0, -4)),
      Number(digits.slice(-4, -2)),
      Number(digits.slice(-2)),
    )
    if (!Number.isFinite(value)) return { text: digits, value: null }
    return { text: clockText(digits), value }
  },
}

/**
 * `"5"` → `"5"`, `"130"` → `"1:30"`, `"10205"` → `"1:02:05"`: the digits, grouped as typed. Not
 * `formatDuration`, which groups a number of SECONDS: typed text keeps its digits as they are —
 * "190" is "1:90" until the field is left, never a "2:30" that moves under the cursor.
 */
function clockText(digits: string): string {
  if (digits.length <= 2) return digits
  const seconds = digits.slice(-2)
  if (digits.length <= 4) return `${digits.slice(0, -2)}:${seconds}`
  return `${digits.slice(0, -4)}:${digits.slice(-4, -2)}:${seconds}`
}

/**
 * A numeric field being edited: the text kept on screen while it is typed, and when that text gives
 * way to the parent's value. The field component only renders `fieldText` and forwards events; every
 * rule is here, where a test reaches it in milliseconds. See docs/08-frontend.md.
 *
 * While focused, the field shows the TEXT being typed, not the number it parses to. Rendering from
 * the number made "62." collapse to "62" under the cursor, so typing 62.5 key by key logged 625 kg;
 * and a parent that refuses an empty field (sets snap back to 1) put a digit back mid-edit, so
 * backspace-then-4 made 14. On blur it shows the parent's value again, whatever that settled to.
 *
 * A value change the field did NOT cause resets the text even while focused. On native the keyboard
 * can stay up while another control is tapped — removing or moving an entry — and the editors are
 * keyed by position, so the same field then holds a different entry's value; keeping the old text
 * made the next digit write old-text-plus-digit into the wrong entry. "Caused by this field" means:
 * changed before the render after its own keystroke `settled`, which is when a parent's clamp lands.
 */
export interface FieldEdit {
  /** The last value the parent gave. */
  readonly value: number | null
  /** What is being typed; null when not editing, so the field shows `value`. */
  readonly text: string | null
  /** A keystroke happened and its render has not settled: a value change now is its answer. */
  readonly own: boolean
}

/**
 * No `focus`: until the first keystroke a focused field shows its value's text, which is what
 * `text: null` shows. The input selects that text on focus, so the first key replaces it.
 */
export type FieldEvent =
  | { readonly kind: 'blur' }
  | { readonly kind: 'settled' }
  /** The field's whole text after a keystroke, as the input reports it. */
  | { readonly kind: 'type'; readonly text: string }
  /** The parent's value changed. */
  | { readonly kind: 'value'; readonly value: number | null }

export interface FieldStep {
  readonly edit: FieldEdit
  /** The value a keystroke means, for the parent; absent when nothing was typed. */
  readonly emit?: number | null
}

/** A field showing `value`, not being typed in. */
export const fieldShowing = (value: number | null): FieldEdit => ({ value, text: null, own: false })

export const fieldText = (edit: FieldEdit, field: Typing): string =>
  edit.text ?? field.toText(edit.value)

/**
 * The next state of a field for one event. An event that changes nothing returns the SAME `edit`,
 * so a component holding it in state does not render again for it.
 */
export function editField(edit: FieldEdit, event: FieldEvent, field: Typing): FieldStep {
  if (event.kind === 'type') {
    const typed = field.parse(event.text)
    return { edit: { ...edit, text: typed.text, own: true }, emit: typed.value }
  }
  if (event.kind === 'value') {
    if (event.value === edit.value) return { edit }
    return { edit: { ...edit, value: event.value, text: edit.own ? edit.text : null } }
  }
  if (event.kind === 'settled') return { edit: edit.own ? { ...edit, own: false } : edit }
  return { edit: edit.text === null ? edit : { ...edit, text: null } }
}
