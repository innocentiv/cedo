import type { LoggedExercise, SessionDay, SessionExercise, SetLog } from '@cedo/contract'
import { formatWithReserve, loggedLabel } from '@cedo/contract'
import { useUnsentSets } from '../api/session-queries.ts'
import { useWeightUnit } from './weight-unit.ts'
import { exerciseName } from './exercise-name.ts'
import { Card, IconButton, ListRow, Stack, Text } from '../ui/index.ts'

/** The pieces the live session screen is assembled from, so the route itself stays control flow. */

/**
 * The plan behind a session is out of the reader's reach — they left the group it lives in, as the
 * server decides it (`SessionPlan`). Said in one line, above a session that stays fully usable: the
 * session is theirs either way.
 */
export function PlanUnavailable(): React.JSX.Element {
  return (
    <Text tone="danger" testID="session-plan-unavailable">
      The plan behind this session is unavailable. Your sets are kept, and you can still log and
      finish.
    </Text>
  )
}

/**
 * Sets logged but not yet sent, shown as soon as logged: a set not sent must not look like a set
 * not logged (#9). When one is held up — no signal, or an answer lost on the way back — the screen
 * asks for the app to stay open: they are kept in memory, and sent in order when the signal
 * returns. Not undoable until sent: there is nothing on the server to take back yet. Named from the
 * day or the ad-hoc picks, since the server has not named them yet.
 */
export function UnsentSets({
  sessionId,
  day,
  adHoc,
}: {
  readonly sessionId: string
  readonly day: SessionDay | undefined
  readonly adHoc: readonly SessionExercise[]
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  const { sets, heldUp } = useUnsentSets(sessionId)
  if (sets.length === 0) return null
  const exerciseOf = (exerciseId: string): LoggedExercise | null =>
    day?.entries.find((e) => e.exerciseId === exerciseId)?.exercise ??
    adHoc.find((e) => e.id === exerciseId) ??
    null
  const count = `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`
  return (
    <Card testID="session-unsent">
      <Stack gap="xs">
        {heldUp ? (
          <Text variant="label" tone="accent">
            {`Keep cedo open — ${count} will be sent when the signal is back.`}
          </Text>
        ) : null}
        {sets.map(({ input, key }) => {
          const exercise = exerciseOf(input.exerciseId)
          return (
            <ListRow
              key={key}
              title={`${exerciseName(exercise)} · not sent yet`}
              subtitle={formatWithReserve(input, exercise?.tracking ?? null, unit)}
              testID={`unsent-set-${key}`}
            />
          )
        })}
      </Stack>
    </Card>
  )
}

/** What has actually been done this session, and the only way to take a mistake back. */
export function LoggedSets({
  logs,
  editable,
  onRemove,
}: {
  /**
   * Each log names its exercise and how it is measured, as far as the caller can still see it —
   * so a weighted pull-up's "+20 kg" reads as added weight even after a reload, or once its plan is
   * out of reach, where the screen used to fall back to a 20 kg lift.
   */
  readonly logs: readonly SetLog[]
  readonly editable: boolean
  readonly onRemove: (logId: string) => void
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  if (logs.length === 0) return null
  return (
    <Stack gap="xs" testID="session-logs">
      <Text variant="label" tone="muted">
        This session
      </Text>
      {logs.map((log) => (
        <ListRow
          key={log.id}
          title={`${exerciseName(log.exercise)} · ${loggedLabel(log, logs)}`}
          subtitle={formatWithReserve(log, log.exercise?.tracking ?? null, unit)}
          accessory={
            editable ? (
              <IconButton
                name="undo"
                label="Undo this set"
                edge="end"
                onPress={() => {
                  onRemove(log.id)
                }}
                testID={`undo-set-${log.id}`}
              />
            ) : undefined
          }
          testID={`logged-set-${log.id}`}
        />
      ))}
    </Stack>
  )
}
