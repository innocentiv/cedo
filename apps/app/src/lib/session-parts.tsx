import type {
  Exercise,
  ProgressionSuggestion,
  SetLog,
  SetTarget,
  TrackingMode,
  WorkoutDay,
  WorkoutEntry,
} from '@cedo/contract'
import { formatEffort } from '@cedo/contract'
import { Button, Card, ListRow, type LoggedValues, SetLogger, Stack, Text } from '../ui/index.ts'

/** The pieces the live session screen is assembled from, so the route itself stays control flow. */

/** The prescription for an entry is its first working set. See docs/adr/0012. */
export const targetOf = (entry: WorkoutEntry): SetTarget | null =>
  entry.sets.find((s) => !s.isWarmup)?.target ?? null

/**
 * What the progression rule says to do next, in one line.
 *
 * `nextTarget` itself lives in the contract and is computed by the API — this only renders the
 * result, so the hint on this screen and the answer the MCP tool gives can never disagree.
 */
export function hintFor(
  suggestion: ProgressionSuggestion | undefined,
  tracking: TrackingMode | undefined,
): string | null {
  if (suggestion === undefined || !suggestion.changed) return null
  return `Next time: ${formatEffort(suggestion.suggested, tracking)}`
}

/** What has actually been done this session, and the only way to take a mistake back. */
export function LoggedSets({
  logs,
  editable,
  onRemove,
}: {
  readonly logs: readonly SetLog[]
  readonly editable: boolean
  readonly onRemove: (logId: string) => void
}): React.JSX.Element | null {
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
            title={`Set ${log.setIndex + 1}`}
            subtitle={formatEffort(log)}
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
 * Chosen exercises are local state, so a reload empties the list. What was already logged survives
 * in the record below, and re-picking continues where it left off.
 */
export function AdHoc({
  chosen,
  logs,
  busy,
  onAdd,
  onLog,
}: {
  readonly chosen: readonly Exercise[]
  readonly logs: readonly SetLog[]
  readonly busy: boolean
  readonly onAdd: () => void
  readonly onLog: (exercise: Exercise, values: LoggedValues) => void
}): React.JSX.Element {
  return (
    <Stack gap="md" testID="session-adhoc">
      {chosen.length === 0 ? (
        <Text tone="muted">No plan behind this one. Add an exercise to start logging.</Text>
      ) : (
        chosen.map((exercise) => (
          <SetLogger
            key={exercise.id}
            exerciseName={exercise.name}
            tracking={exercise.tracking}
            target={null}
            suggestion={null}
            done={logs.filter((l) => l.exerciseId === exercise.id && !l.isWarmup).length}
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
  readonly onLog: (entry: WorkoutEntry, done: number, values: LoggedValues) => void
}): React.JSX.Element {
  return (
    <Stack gap="md">
      {day.entries.map((entry) => {
        const done = logs.filter((l) => l.entryId === entry.id && !l.isWarmup).length
        return (
          <SetLogger
            key={entry.id}
            // An entry whose exercise the caller can no longer see arrives as null, deliberately.
            // See docs/03-domain-model.md.
            exerciseName={entry.exercise?.name ?? 'Unavailable exercise'}
            tracking={entry.exercise?.tracking ?? 'weight_reps'}
            target={targetOf(entry)}
            suggestion={hintFor(suggestions.get(entry.id), entry.exercise?.tracking)}
            done={done}
            busy={busy}
            testID={`log-entry-${entry.index}`}
            onLog={(values) => {
              onLog(entry, done, values)
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
