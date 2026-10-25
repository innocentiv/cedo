import { Pressable, StyleSheet } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { CONTROL_HEIGHT, ICON_SIZE, LOG_CONTROL_HEIGHT, color, radius, stroke } from './tokens.ts'

/**
 * The few glyphs the app draws, on a 24-point grid with a 2-point round stroke — one hand, so they
 * read as a set. Drawn here rather than taken from an icon font: a font is a download for a dozen
 * shapes, and one with a missing glyph falls back to whatever the device has.
 */
const GLYPHS = {
  back: ['M15 18l-6-6 6-6'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  // An arrow turning back, not a circle: a circle reads as reload.
  undo: ['M9 17l-5-5 5-5', 'M4 12h11a5 5 0 0 1 5 5v2'],
  remove: [
    'M3 6h18',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    'M10 11v6',
    'M14 11v6',
  ],
  up: ['M18 15l-6-6-6 6'],
  forward: ['M5 12h14', 'M12 5l7 7-7 7'],
  info: ['M12 16v-4', 'M12 8h.01', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  check: ['M20 6L9 17l-5-5'],
} as const

export type IconName = keyof typeof GLYPHS | 'more'

const TINT = { default: color.text, muted: color.textMuted, onAccent: color.accentText } as const

export function Icon({
  name,
  tone = 'default',
}: {
  readonly name: IconName
  readonly tone?: keyof typeof TINT
}): React.JSX.Element {
  const tint = TINT[tone]
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      {name === 'more'
        ? [5, 12, 19].map((cx) => <Circle key={cx} cx={cx} cy={12} r={1.75} fill={tint} />)
        : GLYPHS[name].map((d) => (
            <Path
              key={d}
              d={d}
              stroke={tint}
              strokeWidth={stroke.bold}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
    </Svg>
  )
}

/**
 * A secondary action as a glyph alone — close, undo, remove, back, how to — so it stays out of the way of
 * what the screen is for. Said aloud by its `label`. Its touch area is a full control; `edge` pulls
 * that area out past the content's edge, so the glyph itself lines up with the text beside it.
 * `raised` sits on a disc, for a control used every set: the logger's − and +.
 */
export function IconButton({
  name,
  label,
  onPress,
  edge,
  raised = false,
  tone = 'muted',
  testID,
}: {
  readonly name: IconName
  readonly label: string
  readonly onPress: () => void
  readonly edge?: 'start' | 'end' | undefined
  readonly raised?: boolean
  readonly tone?: keyof typeof TINT
  readonly testID?: string | undefined
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        raised ? styles.raised : styles.plain,
        edge === 'start' ? styles.start : null,
        edge === 'end' ? styles.end : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Icon name={name} tone={raised ? 'default' : tone} />
    </Pressable>
  )
}

/** How far a plain glyph sits inside its touch area: what `edge` takes back. */
const INSET = (CONTROL_HEIGHT - ICON_SIZE) / 2

const styles = StyleSheet.create({
  plain: {
    width: CONTROL_HEIGHT,
    height: CONTROL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  raised: {
    width: LOG_CONTROL_HEIGHT,
    height: LOG_CONTROL_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  start: { marginLeft: -INSET },
  end: { marginRight: -INSET },
  pressed: { opacity: 0.6 },
})
