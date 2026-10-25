import { type SessionDetail, formatDuration, formatEffort, sessionSummary } from '@cedo/contract'
import { Card, Stack, Text } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * What a finished session came to (#24): how long it took, its working sets, and its personal
 * bests by name — shown once it is finished, and whenever it is opened again. Its sets follow, as
 * the screen lists them. The numbers are the contract's `sessionSummary`.
 */
export function FinishedSummary({
  session,
}: {
  readonly session: SessionDetail
}): React.JSX.Element {
  const unit = useWeightUnit()
  const summary = sessionSummary(session)
  return (
    <Card testID="session-finished">
      <Stack gap="md">
        <Stack direction="row" gap="xl">
          <Stack gap="xs">
            <Text variant="caption" tone="muted">
              Time
            </Text>
            <Text variant="number" testID="session-finished-time">
              {summary.durationS === null ? '—' : formatDuration(summary.durationS)}
            </Text>
          </Stack>
          <Stack gap="xs">
            <Text variant="caption" tone="muted">
              Working sets
            </Text>
            <Text variant="number" testID="session-finished-sets">
              {String(summary.workingSets)}
            </Text>
          </Stack>
        </Stack>
        {summary.personalBests.length === 0 ? null : (
          <Stack gap="xs" testID="session-finished-bests">
            <Text variant="label" tone="success">
              {summary.personalBests.length === 1
                ? 'A personal best'
                : `${summary.personalBests.length} personal bests`}
            </Text>
            {summary.personalBests.map((log) => (
              <Text key={log.id}>
                {`${exerciseName(log.exercise)} · ${formatEffort(log, log.exercise?.tracking ?? null, unit)}`}
              </Text>
            ))}
          </Stack>
        )}
        {session.notes === null ? null : (
          <Text tone="muted" testID="session-finished-notes">
            {session.notes}
          </Text>
        )}
      </Stack>
    </Card>
  )
}
