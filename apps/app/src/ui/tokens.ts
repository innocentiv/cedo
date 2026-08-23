/**
 * The entire visual vocabulary. A screen may use these values and nothing else — no literal colours,
 * no magic pixel numbers. See docs/08-frontend.md.
 *
 * Dark only, deliberately. This is used in a gym, usually in poor light, and a single palette means
 * every primitive is one style object rather than a themed one resolved per render. Adding a light
 * theme later is a second map plus a `useColorScheme()` lookup in `useTheme` — no screen changes.
 */

export const color = {
  /** Page background, one step up for cards, one more for pressed states. */
  bg: '#0b0d10',
  surface: '#15181d',
  surfaceRaised: '#1e222a',
  border: '#2a2f38',

  text: '#eef1f5',
  textMuted: '#9aa4b2',
  textFaint: '#6b7482',

  /** One accent. More than one and screens start encoding meaning in colour. */
  accent: '#4c8dff',
  accentText: '#ffffff',

  danger: '#ff5c5c',
  success: '#3ecf8e',
  warning: '#e6b455',
} as const

/** A four-point scale. Anything between two steps is a design decision nobody made on purpose. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const

export const type = {
  title: { fontSize: 28, fontWeight: '700', lineHeight: 34 },
  heading: { fontSize: 20, fontWeight: '600', lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 17 },
  mono: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
} as const

export type TypeVariant = keyof typeof type

/**
 * One breakpoint. Phones and tablets differ in whether a list and a detail fit side by side, and
 * that is the only layout question this app has. More breakpoints would be more states to verify.
 */
export const TABLET_MIN_WIDTH = 768

/** Touch targets. 44 is the smallest reliably hittable control with a thumb, mid-set. */
export const CONTROL_HEIGHT = 48
