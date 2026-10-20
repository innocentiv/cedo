import type {
  Effort,
  ProgressionSuggestion,
  SessionExercise,
  SetLog,
  WorkoutDay,
  WorkoutEntry,
} from '@cedo/contract'
import { type WeightUnit, formatEffort, prescriptionOf, workingSetsDone } from '@cedo/contract'
import { useWeightUnit } from './weight-unit.ts'
import { exerciseName } from './exercise-name.ts'
import { Button, Card, ListRow, SetLogger, Stack, Text } from '../ui/index.ts'

/** The pieces the live session screen is assembled from, so the route itself stays control flow. */

/**
 * What the progression rule says to do next, in one line.
 *
 * `nextTarget` itself lives in the contract and is computed by the API — this only renders the
 * result, so the hint on this screen and the answer the MCP tool gives can never disagree.
 */
export function hintFor(
  suggestion: ProgressionSuggestion | undefined,
  unit: WeightUnit,
): string | null {
  if (suggestion === undefined || !suggestion.changed) return null
  return `Next time: ${formatEffort(suggestion.suggested, suggestion.tracking, unit)}`
}

/**
 * The plan behind a session failed to load — usually because the user lost access to its group.
 * Said in one line, above a session that stays fully usable: the session is theirs either way.
 */
export function PlanUnavailable({ reason }: { readonly reason: string }): React.JSX.Element {
  return (
    <Text tone="danger" testID="session-plan-unavailable">
      {`The plan behind this session is unavailable (${reason}). Your sets are kept, and you can still log and finish.`}
    </Text>
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
            subtitle={formatEffort(log, log.exercise?.tracking ?? null, unit)}
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
  readonly onLog: (exercise: SessionExercise, values: Effort) => void
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
            suggestion={null}
            done={workingSetsDone(logs, { entryId: null, exerciseId: exercise.id })}
            busy={busy}
            testID={`adhoc-${exercise.id}`}
            onLog={(values) => {
              onLog(exercise, values)
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

/** The prescribed day, one logger per entry, showing what was planned against what has been done. */
export function PlannedDay({
  day,
  logs,
  suggestions,
  busy,
  onLog,
}: {
  readonly day: WorkoutDay
  readonly logs: readonly SetLog[]
  readonly suggestions: ReadonlyMap<string, ProgressionSuggestion>
  readonly busy: boolean
  readonly onLog: (entry: WorkoutEntry, values: Effort) => void
}): React.JSX.Element {
  const unit = useWeightUnit()
  return (
    <Stack gap="md">
      {day.entries.map((entry) => {
        const done = workingSetsDone(logs, { entryId: entry.id, exerciseId: entry.exerciseId })
        return (
          <SetLogger
            key={entry.id}
            // An entry whose exercise the caller can no longer see arrives as null, deliberately.
            // See docs/03-domain-model.md.
            exerciseName={exerciseName(entry.exercise)}
            tracking={entry.exercise?.tracking ?? 'weight_reps'}
            target={prescriptionOf(entry)?.target ?? null}
            suggestion={hintFor(suggestions.get(entry.id), unit)}
            done={done}
            busy={busy}
            testID={`log-entry-${entry.index}`}
            onLog={(values) => {
              onLog(entry, values)
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
