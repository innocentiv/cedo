import { StyleSheet, View } from 'react-native'
import {
  type ExerciseHistory,
  type TrendPoint,
  formatEffort,
  formatWeight,
  trendOf,
} from '@cedo/contract'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { Card } from './card.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { color, radius, space } from './tokens.ts'

const BAR_HEIGHT = 72

/**
 * Am I progressing? One bar per session, oldest first, as the contract draws it (`trendOf`): a
 * weight lift's best estimated max, or the top set's own measure — with the first and the latest
 * said in words, and the server's stall (`ExerciseHistory.stalled`) as a badge. Nothing to read
 * from one session, so it needs two.
 */
export function ProgressTrend({
  history,
  testID,
}: {
  readonly history: ExerciseHistory
  readonly testID: string
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  const points = trendOf(history)
  const [first] = points
  const latest = points.at(-1)
  if (first === undefined || latest === undefined || points.length < 2) return null

  const said = (p: TrendPoint) =>
    p.estimated ? formatWeight(p.value, unit) : formatEffort(p.top, history.tracking, unit)
  // Read by its change, so drawn from just below the lowest point: from zero, 64 kg against 70 kg
  // were bars of one height. A quarter of the height is kept, so the lowest is still a bar.
  const values = points.map((p) => p.value)
  const [lowest, highest] = [Math.min(...values), Math.max(...values)]
  const heightOf = (value: number) =>
    highest === lowest
      ? BAR_HEIGHT
      : BAR_HEIGHT * (0.25 + (0.75 * (value - lowest)) / (highest - lowest))
  const { stalled } = history

  return (
    <Card testID={testID}>
      <Stack gap="sm">
        <Stack direction="row" gap="sm" align="center">
          <Stack grow>
            <Text variant="label" tone="muted">
              {latest.estimated ? 'Estimated max' : 'Top set'}
            </Text>
          </Stack>
          {stalled === null ? null : (
            <Text variant="caption" tone="warning" testID={`${testID}-stalled`}>
              {`Stalled · ${stalled.sessions} sessions at ${formatEffort(stalled.effort, history.tracking, unit)}`}
            </Text>
          )}
        </Stack>
        <View style={styles.bars} testID={`${testID}-bars`}>
          {points.map((p) => (
            <View key={p.sessionId} style={[styles.bar, { height: heightOf(p.value) }]} />
          ))}
        </View>
        <Stack direction="row" gap="sm">
          <Stack grow>
            <Text variant="caption" tone="faint">{`${said(first)} at first`}</Text>
          </Stack>
          <Text variant="caption" testID={`${testID}-latest`}>{`${said(latest)} now`}</Text>
        </Stack>
      </Stack>
    </Card>
  )
}

const styles = StyleSheet.create({
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xs,
    height: BAR_HEIGHT,
  },
  bar: { flex: 1, backgroundColor: color.accent, borderRadius: radius.sm, maxWidth: 28 },
})
