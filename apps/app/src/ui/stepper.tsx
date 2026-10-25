import { Pressable, StyleSheet } from 'react-native'
import { type Dimension, type TrackingMode, stepped } from '@cedo/contract'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { DimensionInput } from './dimension-input.tsx'
import { LOG_CONTROL_HEIGHT, color, radius } from './tokens.ts'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/**
 * One of the next set's numbers, as large as the screen allows, between − and +. The steps are the
 * contract's (`stepped`): a pair of the smallest plates, a rep, five seconds, a hundred metres. A
 * tap on the number types it, as any measured field is typed.
 */
export function Stepper({
  dimension,
  tracking,
  value,
  onChange,
  testID,
}: {
  readonly dimension: Dimension
  readonly tracking: TrackingMode
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly testID: string
}): React.JSX.Element {
  const unit = useWeightUnit()
  const step = (by: 1 | -1) => () => {
    onChange(stepped(value, by, dimension, tracking, unit))
  }
  return (
    <Stack direction="row" align="center" gap="sm">
      <StepButton label="−" onPress={step(-1)} testID={`${testID}-less`} />
      <Stack grow>
        <DimensionInput
          dimension={dimension}
          tracking={tracking}
          value={value}
          onChange={onChange}
          size="large"
          testID={testID}
        />
      </Stack>
      <StepButton label="+" onPress={step(1)} testID={`${testID}-more`} />
    </Stack>
  )
}

function StepButton({
  label,
  onPress,
  testID,
}: {
  readonly label: string
  readonly onPress: () => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'One step more' : 'One step less'}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.step, pressed ? styles.pressed : null]}
    >
      <Text variant="number">{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  step: {
    width: LOG_CONTROL_HEIGHT,
    height: LOG_CONTROL_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: color.border },
})
