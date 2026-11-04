import { useRouter } from 'expo-router'
import type { LoggedExercise, SessionDay, SessionExercise, SetLog } from '@cedo/contract'
import { byExercise, formatWithReserve, loggedLabel, loggedTitle } from '@cedo/contract'
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

/**
 * What has actually been done this session in progress, and the only way to take a mistake back.
 * Once finished, its sets read back by exercise instead (`SetsByExercise`).
 */
export function LoggedSets({
  logs,
  onRemove,
}: {
  /**
   * Each log names its exercise and how it is measured, as far as the caller can still see it —
   * so a weighted pull-up's "+20 kg" reads as added weight even after a reload, or once its plan is
   * out of reach, where the screen used to fall back to a 20 kg lift.
   */
  readonly logs: readonly SetLog[]
  readonly onRemove: (log: SetLog) => void
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
            <IconButton
              name="undo"
              label="Undo this set"
              edge="end"
              onPress={() => {
                onRemove(log)
              }}
              testID={`undo-set-${log.id}`}
            />
          }
          testID={`logged-set-${log.id}`}
        />
      ))}
    </Stack>
  )
}

/**
 * A finished session's sets by exercise (#25), each exercise once in the order first done: how it
 * is read back. Its personal bests marked green, as they are judged now. Each set opens to be fixed
 * (#31) where the reader may fix it — their own; a coach's view reads them only.
 */
export function SetsByExercise({
  logs,
  historyHref,
  onOpen,
}: {
  readonly logs: readonly SetLog[]
  readonly onOpen?: (log: SetLog) => void
  /**
   * Where an exercise's history is, opened from its name — read by a coach (#30), whose session page
   * is the way into an athlete's history. Never for an exercise the reader cannot see: no name.
   */
  readonly historyHref?: (exerciseId: string) => string
}): React.JSX.Element {
  const unit = useWeightUnit()
  const router = useRouter()
  return (
    <Stack gap="xl" testID="session-logs">
      {byExercise(logs).map((sets) => (
        <Stack key={sets[0]?.exerciseId} gap="xs">
          {historyHref === undefined || sets[0]?.exercise == null ? (
            <Text variant="label" tone="muted">
              {exerciseName(sets[0]?.exercise ?? null)}
            </Text>
          ) : (
            <ListRow
              title={exerciseName(sets[0].exercise)}
              trailing="History"
              onPress={() => {
                router.push(historyHref(sets[0]?.exerciseId ?? ''))
              }}
              testID={`exercise-history-of-${sets[0].exerciseId}`}
            />
          )}
          {sets.map((log) => (
            <ListRow
              key={log.id}
              title={loggedTitle(log, logs)}
              subtitle={formatWithReserve(log, log.exercise?.tracking ?? null, unit)}
              accessory={
                log.personalBest ? (
                  <Text variant="label" tone="best">
                    PB
                  </Text>
                ) : undefined
              }
              onPress={
                onOpen === undefined
                  ? undefined
                  : () => {
                      onOpen(log)
                    }
              }
              testID={`logged-set-${log.id}`}
            />
          ))}
        </Stack>
      ))}
    </Stack>
  )
}
