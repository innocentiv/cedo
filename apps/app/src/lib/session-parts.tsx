import type {
  Effort,
  EntryTarget,
  LoggedExercise,
  SessionDay,
  SessionExercise,
  SetLog,
  WorkoutEntry,
} from '@cedo/contract'
import { formatWithReserve, prescriptionOf, workingSetsDone } from '@cedo/contract'
import { useWaitingSets } from '../api/queries.ts'
import { useWeightUnit } from './weight-unit.ts'
import { exerciseName } from './exercise-name.ts'
import { Button, Card, ListRow, SetLogger, Stack, Text } from '../ui/index.ts'

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
 * Sets logged but not yet sent — no signal, or an answer lost on the way back (#9). Kept in memory,
 * sent in order when the signal returns, so the screen asks for the app to stay open. Each is shown
 * as soon as it is logged: a set not yet sent must not look like a set not logged. Not undoable
 * until sent: there is nothing on the server to take back yet.
 */
export function WaitingSets({
  sessionId,
  day,
  adHoc,
}: {
  readonly sessionId: string
  /** Where a waiting set's exercise is named: the day's entries, or the session's ad-hoc picks. */
  readonly day: SessionDay | undefined
  readonly adHoc: readonly SessionExercise[]
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  const sets = useWaitingSets(sessionId)
  if (sets.length === 0) return null
  const exerciseOf = (exerciseId: string): LoggedExercise | null =>
    day?.entries.find((e) => e.exerciseId === exerciseId)?.exercise ??
    adHoc.find((e) => e.id === exerciseId) ??
    null
  const count = `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`
  return (
    <Card testID="session-waiting">
      <Stack gap="xs">
        <Text variant="label" tone="warning">
          {`Keep cedo open — ${count} will be sent when the signal is back.`}
        </Text>
        {sets.map((set, i) => {
          const exercise = exerciseOf(set.exerciseId)
          return (
            <ListRow
              // Not yet sent, so no id: the queue's order is the only identity it has.
              // oxlint-disable-next-line react/no-array-index-key
              key={i}
              title={`${exerciseName(exercise)} · waiting for signal`}
              subtitle={formatWithReserve(set, exercise?.tracking ?? null, unit)}
              testID={`waiting-set-${i}`}
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
    <Card testID="session-logs">
      <Stack gap="xs">
        <Text variant="label" tone="muted">
          Logged
        </Text>
        {logs.map((log) => (
          <ListRow
            key={log.id}
            title={`${exerciseName(log.exercise)} · set ${log.setIndex + 1}`}
            subtitle={formatWithReserve(log, log.exercise?.tracking ?? null, unit)}
            trailing={editable ? 'Undo' : undefined}
            onPress={
              editable
                ? () => {
                    onRemove(log.id)
                  }
                : undefined
            }
            testID={`logged-set-${log.id}`}
          />
        ))}
      </Stack>
    </Card>
  )
}

/**
 * A session with no plan behind it. The API has always supported this — `set_logs.entry_id` is
 * nullable precisely so walking in and lifting uses the same tables — and MCP exposes it, but the
 * UI had no way to reach it: "Log without a plan" opened a screen that told you to log an exercise
 * and offered no means to. See docs/03-domain-model.md.
 *
 * Its loggers are the exercises it has logged, then any picked since, so a reload continues where
 * it left off: picked-but-unlogged ones are local state and do not survive it, which loses nothing.
 */
export function AdHoc({
  exercises,
  logs,
  busy,
  onAdd,
  onLog,
}: {
  /** What the session has logged, then anything picked since — `exercisesInSession`. */
  readonly exercises: readonly SessionExercise[]
  readonly logs: readonly SetLog[]
  readonly busy: boolean
  readonly onAdd: () => void
  readonly onLog: (exercise: SessionExercise, values: Effort, rpe: number | null) => void
}): React.JSX.Element {
  return (
    <Stack gap="md" testID="session-adhoc">
      {exercises.length === 0 ? (
        <Text tone="muted">No plan behind this one. Add an exercise to start logging.</Text>
      ) : (
        exercises.map((exercise) => (
          <SetLogger
            key={exercise.id}
            exerciseName={exercise.name}
            tracking={exercise.tracking}
            target={null}
            prescribed={null}
            last={null}
            cue={null}
            rest={null}
            done={workingSetsDone(logs, { entryId: null, exerciseId: exercise.id })}
            busy={busy}
            testID={`adhoc-${exercise.id}`}
            onLog={(values, rpe) => {
              onLog(exercise, values, rpe)
            }}
          />
        ))
      )}
      <Button
        title="Add an exercise"
        variant="secondary"
        onPress={onAdd}
        testID="adhoc-add-exercise"
      />
    </Stack>
  )
}

/**
 * The prescribed day, one logger per entry, each pre-filled with what this session asks of it —
 * the plan carried forward by its rule (`EntryTarget`) — beside what was done last time, and each
 * entry's done count the server's, counted in the series it numbers by.
 *
 * An entry the server asks nothing of — its exercise unavailable to the reader — shows the plan's
 * own prescription, as it always did.
 */
export function PlannedDay({
  day,
  targets,
  logs,
  busy,
  onLog,
}: {
  readonly day: SessionDay
  readonly targets: readonly EntryTarget[]
  /** The session's sets so far: each entry's rest is counted from its latest working one. */
  readonly logs: readonly SetLog[]
  readonly busy: boolean
  readonly onLog: (entry: WorkoutEntry, values: Effort, rpe: number | null) => void
}): React.JSX.Element {
  return (
    <Stack gap="md">
      {day.entries.map((entry) => {
        const asked = targets.find((t) => t.entryId === entry.id)
        return (
          <SetLogger
            key={entry.id}
            // An entry whose exercise the caller can no longer see arrives as null, deliberately.
            // See docs/03-domain-model.md.
            exerciseName={exerciseName(entry.exercise)}
            tracking={entry.exercise?.tracking ?? null}
            target={asked?.target ?? prescriptionOf(entry)?.target ?? null}
            prescribed={asked?.changed === true ? asked.prescribed : null}
            last={asked?.last ?? null}
            cue={entry.cue}
            rest={{ logs, entry }}
            done={entry.done}
            busy={busy}
            testID={`log-entry-${entry.index}`}
            onLog={(values, rpe) => {
              onLog(entry, values, rpe)
            }}
          />
        )
      })}
    </Stack>
  )
}

/** Finish while it is open; leave once it is closed. A finished session is never reopened. */
export function SessionFooter({
  ended,
  busy,
  onLeave,
  onFinish,
}: {
  readonly ended: boolean
  readonly busy: boolean
  readonly onLeave: () => void
  readonly onFinish: () => void
}): React.JSX.Element {
  if (ended) {
    return <Button title="Done" variant="secondary" onPress={onLeave} testID="leave-session" />
  }
  return <Button title="Finish session" onPress={onFinish} busy={busy} testID="finish-session" />
}
