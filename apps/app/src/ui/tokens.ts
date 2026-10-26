/**
 * The entire visual vocabulary. A screen may use these values and nothing else — no literal colours,
 * no magic pixel numbers. See docs/08-frontend.md, "The look".
 *
 * Dark only, deliberately: this is used in a gym, usually in poor light. A single palette means
 * every primitive is one style object rather than a themed one resolved per render.
 *
 * The look is the gym's own (#24): chalk on a rubber floor, and the colour code of calibrated plates
 * — red 25, blue 20, yellow 15, green 10, white 5 — which every lifter already reads. A plate colour
 * is used ONLY for state, and means ONE thing on every screen; everything else is chalk and grey.
 */

/** The plates, as stamped. Read through `color`'s meanings below, never directly by a primitive. */
const plate = {
  red: '#e0393e',
  blue: '#2f6fd6',
  yellow: '#f2b90f',
  green: '#22a35a',
  white: '#ece8e1',
} as const

export const color = {
  /** The floor; one step up for what sits on it; one more for what is pressed or raised. */
  bg: '#1b1c1e',
  surface: '#232427',
  surfaceRaised: '#2c2d31',
  border: '#3a3b40',
  /** Over the screen behind a sheet: dimmed, still there. */
  scrim: 'rgba(0, 0, 0, 0.55)',

  /** Chalk, and two dustings of it. */
  text: plate.white,
  textMuted: '#a9a49b',
  textFaint: '#77736c',

  /**
   * Yellow — act now: the next set, the action to take, the session waiting for you. Never a
   * selection, never a decoration: what is chosen is chalk.
   */
  accent: plate.yellow,
  /** What is written on yellow: the floor's colour, for contrast in a dim room. */
  accentText: '#1b1c1e',

  /** Blue — rest. */
  rest: plate.blue,

  /** Green — a personal best, and nothing else. */
  best: plate.green,

  /** White — a warm-up: the lightest plate, a set that is ramp, not work. */
  warmup: plate.white,

  /** Red — careful: something went wrong, or a change cannot be taken back. */
  danger: plate.red,
} as const

/** A four-point scale. Anything between two steps is a design decision nobody made on purpose. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const

/** Lines: a hairline divides, a bold one marks — the next set, a set re-opened, a superset. */
export const stroke = { hairline: 1, bold: 2 } as const

/**
 * Two widths of one family. Barlow Condensed is the stamped numeral of a plate and a gym clock —
 * weights, reps, times, titles — with tabular figures so a number does not shift as it changes;
 * Barlow carries everything read as a sentence. Bundled (`app/_layout.tsx`), never fetched.
 */
export const font = {
  regular: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  semibold: 'Barlow_600SemiBold',
  numeral: 'BarlowCondensed_600SemiBold',
  numeralBold: 'BarlowCondensed_700Bold',
} as const

const tabular = ['tabular-nums'] as const

export const type = {
  /** The next set's numbers, as large as the screen allows. */
  display: { fontSize: 64, lineHeight: 68, fontFamily: font.numeralBold, fontVariant: tabular },
  /** A number that is read at a glance: a rest, a set in a list. */
  number: { fontSize: 28, lineHeight: 32, fontFamily: font.numeral, fontVariant: tabular },
  title: { fontSize: 32, lineHeight: 36, fontFamily: font.numeralBold },
  heading: { fontSize: 20, lineHeight: 26, fontFamily: font.semibold },
  body: { fontSize: 16, lineHeight: 22, fontFamily: font.regular },
  label: { fontSize: 15, lineHeight: 20, fontFamily: font.semibold },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: font.medium },
  mono: { fontSize: 17, lineHeight: 22, fontFamily: font.numeral, fontVariant: tabular },
} as const

export type TypeVariant = keyof typeof type

/**
 * One breakpoint. Phones and tablets differ in whether a list and a detail fit side by side, and
 * that is the only layout question this app has. More breakpoints would be more states to verify.
 */
export const TABLET_MIN_WIDTH = 768

/** Touch targets. 44 is the smallest reliably hittable control with a thumb, mid-set. */
export const CONTROL_HEIGHT = 48

/** A row of a list: a thumb's height, and room for a name over a line of detail. */
export const ROW_HEIGHT = 56

/** A glyph (`icon.tsx`): drawn on a 24-point grid, shown at that size. */
export const ICON_SIZE = 24

/** An exercise's picture in a row of a list (#27): small, at the 16:9 a video is. */
export const ROW_THUMB_WIDTH = 64

/** A `Meter`'s bar: a line, read at a glance beside the number it draws. */
export const METER_HEIGHT = 4

/** One set's mark on the workout; a warm-up's is a step smaller. */
export const MARK_SIZE = 40

/** Where a set is logged — the step buttons, Log — nothing is smaller: a thumb, between sets. */
export const LOG_CONTROL_HEIGHT = 56

/**
 * How wide content is allowed to get. Beyond this a line of text or a form field is harder to read,
 * not easier — a tablet gets more margin, not wider inputs.
 */
export const CONTENT_MAX_WIDTH = 720

/**
 * A screen of two columns side by side (`Columns`) — the workout on a desktop: wider in all, each
 * column still narrower than one column alone.
 */
export const WIDE_CONTENT_MAX_WIDTH = 1120
