import { Pressable, StyleSheet, View } from 'react-native'
import { RESERVE_CHOICES, formatReserve, reserveOf, rpeOf } from '@cedo/contract'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { CONTROL_HEIGHT, color, radius, stroke } from './tokens.ts'

/**
 * Reps in reserve — the question RPE is asked as (`rpe.ts`): none to five, whole, as one row of
 * equal segments, so it never wraps under the thumb. Tapping the chosen one again takes the answer
 * back: not said needs no segment of its own. Holds an RPE, so the screen never converts: the
 * contract does.
 */
export function ReserveChips({
  label,
  rpe,
  onChange,
  testID,
}: {
  readonly label: string
  readonly rpe: number | null
  readonly onChange: (rpe: number | null) => void
  readonly testID: string
}): React.JSX.Element {
  const chosen = rpe === null ? null : reserveOf(rpe)
  return (
    <Stack gap="xs">
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View style={styles.row} testID={testID}>
        {RESERVE_CHOICES.map((reserve, i) => (
          <Pressable
            key={reserve}
            accessibilityRole="button"
            accessibilityLabel={`${formatReserve(reserve)} in reserve`}
            aria-selected={reserve === chosen}
            onPress={() => {
              onChange(reserve === chosen ? null : rpeOf(reserve))
            }}
            testID={`${testID}-${String(reserve)}`}
            style={({ pressed }) => [
              styles.segment,
              i > 0 ? styles.divided : null,
              reserve === chosen ? styles.chosen : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text variant="mono" tone={reserve === chosen ? 'default' : 'muted'}>
              {formatReserve(reserve)}
            </Text>
          </Pressable>
        ))}
      </View>
    </Stack>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    height: CONTROL_HEIGHT,
    borderRadius: radius.md,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    overflow: 'hidden',
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  divided: { borderLeftWidth: stroke.hairline, borderLeftColor: color.border },
  chosen: { backgroundColor: color.surfaceRaised },
  pressed: { backgroundColor: color.border },
})
