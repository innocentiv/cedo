import { StyleSheet } from 'react-native'
import { type Dimension, type Load, type TrackingMode, stepped } from '@cedo/contract'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { DimensionInput } from './dimension-input.tsx'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'
import { type } from './tokens.ts'

/**
 * One of the next set's numbers, as large as the screen allows, between − and +. The steps are the
 * contract's (`stepped`): a pair of the smallest plates, a rep, five seconds, a hundred metres — or,
 * for a weight whose load is known, the next weight the athlete can load (#36). A tap on the number
 * types it, as any measured field is typed, and any weight may be typed.
 */
export function Stepper({
  dimension,
  tracking,
  load = null,
  value,
  onChange,
  testID,
}: {
  readonly dimension: Dimension
  readonly tracking: TrackingMode
  readonly load?: Load | null
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly testID: string
}): React.JSX.Element {
  const unit = useWeightUnit()
  const step = (by: 1 | -1) => () => {
    onChange(stepped(value, by, dimension, tracking, unit, load))
  }
  // Level with the number's line, not with an assistance choice under it.
  return (
    <Stack direction="row" align="flex-start" gap="sm">
      <Stack justify="center" style={styles.level}>
        <IconButton
          name="minus"
          label="One step less"
          raised
          onPress={step(-1)}
          testID={`${testID}-less`}
        />
      </Stack>
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
      <Stack justify="center" style={styles.level}>
        <IconButton
          name="plus"
          label="One step more"
          raised
          onPress={step(1)}
          testID={`${testID}-more`}
        />
      </Stack>
    </Stack>
  )
}

const styles = StyleSheet.create({ level: { height: type.display.lineHeight } })
