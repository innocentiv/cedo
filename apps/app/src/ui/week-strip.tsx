import { StyleSheet, View } from 'react-native'
import type { WeekDay } from '@cedo/contract'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { MARK_SIZE, color, radius, stroke } from './tokens.ts'

/**
 * The week at a glance (#25): a mark per day, Monday first — filled where a session was trained,
 * today ringed in chalk. No plate colour: a day trained is a fact, not a state to act on.
 */
export function WeekStrip({
  days,
  testID,
}: {
  readonly days: readonly WeekDay[]
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack direction="row" gap="sm" testID={testID}>
      {days.map((day) => (
        <View
          key={day.index}
          accessibilityLabel={`${day.initial}${day.trained ? ', trained' : ''}`}
          testID={`${testID}-${String(day.index)}${day.trained ? '-trained' : ''}`}
          style={[styles.day, day.trained ? styles.trained : null, day.today ? styles.today : null]}
        >
          <Text variant="caption" tone={day.trained ? 'default' : 'faint'}>
            {day.initial}
          </Text>
        </View>
      ))}
    </Stack>
  )
}

const styles = StyleSheet.create({
  day: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    borderRadius: radius.pill,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trained: { backgroundColor: color.surfaceRaised, borderColor: color.surfaceRaised },
  today: { borderColor: color.text, borderWidth: stroke.bold },
})
