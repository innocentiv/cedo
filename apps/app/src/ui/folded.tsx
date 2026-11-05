import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'
import { color, type } from './tokens.ts'

/** How many of the lines shown fade out, from the last up. */
const FADE_LINES = 2

/**
 * Long text kept to its first lines, with a chevron to show the rest (#51) — so a workout's notes,
 * above its plan, do not push the plan off the screen. Measured as it is laid out, not counted in
 * lines of source: a heading and a table take very different room. Nothing is offered when nothing
 * is hidden.
 *
 * Folded, its last lines fade into a card's surface (`Card`), where folded text sits.
 *
 * Its controls are small glyphs on one line under the text, as rarely used as pinning: the chevron
 * centred, and what else can be done with the text — Edit — at the right edge.
 */
export function Folded({
  lines,
  children,
  action,
  testID,
}: {
  /** How many lines of body text show while folded. */
  readonly lines: number
  readonly children: React.ReactNode
  /** At the right edge under the text: a small `IconButton`, `edge="end"`. */
  readonly action?: React.ReactNode
  readonly testID: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState(0)
  const folded = lines * type.body.lineHeight
  // Half a line over is not worth a control: it is shown.
  const folds = height > folded + type.body.lineHeight / 2
  return (
    <Stack gap="xs">
      <View style={folds && !open ? [styles.clip, { maxHeight: folded }] : null}>
        <View
          onLayout={(event) => {
            setHeight(event.nativeEvent.layout.height)
          }}
        >
          {children}
        </View>
        {folds && !open ? <Fade /> : null}
      </View>
      {folds || action !== undefined ? (
        <Stack direction="row" align="center">
          <View style={styles.side} />
          {folds ? (
            <IconButton
              name={open ? 'up' : 'down'}
              label={open ? 'Show less' : 'Show all'}
              size="small"
              onPress={() => {
                setOpen(!open)
              }}
              testID={`${testID}-fold`}
            />
          ) : null}
          <View style={[styles.side, styles.end]}>{action}</View>
        </Stack>
      ) : null}
    </Stack>
  )
}

/**
 * The last lines shown, fading into the card they sit on, so a cut reads as more to come rather
 * than as the end. Over the text, never in the way of a tap on it: it takes no touches.
 */
function Fade(): React.JSX.Element {
  return (
    <View style={styles.fade} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="fold-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.surface} stopOpacity={0} />
            <Stop offset="1" stopColor={color.surface} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#fold-fade)" />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: FADE_LINES * type.body.lineHeight,
  },
  side: { flex: 1 },
  end: { alignItems: 'flex-end' },
})
