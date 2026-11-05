import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'
import { type } from './tokens.ts'

/**
 * Long text kept to its first lines, with a chevron to show the rest (#51) — so a workout's notes,
 * above its plan, do not push the plan off the screen. Measured as it is laid out, not counted in
 * lines of source: a heading and a table take very different room. Nothing is offered when nothing
 * is hidden.
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

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  side: { flex: 1 },
  end: { alignItems: 'flex-end' },
})
