import { useMemo } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { formatWeight } from '@cedo/contract'
import type { ProgressionSuggestion, SetLog, SetTarget, WorkoutEntry } from '@cedo/contract'
import {
  Button,
  Card,
  ErrorNotice,
  ListRow,
  Screen,
  SetLogger,
  Spinner,
  Stack,
  Text,
} from '../../../../src/ui/index.ts'
import {
  useLogSet,
  useProgression,
  useRemoveLog,
  useSession,
  useUpdateSession,
  useWorkout,
} from '../../../../src/api/queries.ts'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

/** The prescription for an entry is its first working set. See docs/adr/0012. */
const targetOf = (entry: WorkoutEntry): SetTarget | null =>
  entry.sets.find((s) => !s.isWarmup)?.target ?? null

/**
 * What the progression rule says to do next, in one line.
 *
 * `nextTarget` itself lives in the contract and is computed by the API — this only renders the
 * result, so the hint on this screen and the answer the MCP tool gives can never disagree.
 */
function hintFor(suggestion: ProgressionSuggestion | undefined): string | null {
  if (suggestion === undefined || !suggestion.changed) return null
  const { suggested } = suggestion
  const load = suggested.weightG === null ? 'bodyweight' : formatWeight(suggested.weightG)
  return `Next time: ${suggested.reps ?? '—'} × ${load}`
}

/** What has actually been done this session, and the only way to take a mistake back. */
function LoggedSets({
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
            subtitle={`${log.reps ?? '—'} × ${
              log.weightG === null ? 'bodyweight' : formatWeight(log.weightG)
            }`}
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

export default function LiveSession(): React.JSX.Element {
  // `[id]`, not `[sessionId]`: route filenames are kebab-case like every other file, and a
  // camelCase segment cannot be spelled that way.
  const { id: sessionId } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const id = sessionId ?? ''

  const session = useSession(id)
  const workoutId = session.data?.workoutId ?? ''
  const workout = useWorkout(workoutId)
  const progression = useProgression(workoutId)
  const logSet = useLogSet(id)
  const removeLog = useRemoveLog(id)
  const finish = useUpdateSession(id)
  const { submit, busy, error } = useSubmit()

  const day = useMemo(
    () => workout.data?.days.find((d) => d.id === session.data?.dayId),
    [workout.data, session.data],
  )
  const suggestions = useMemo(
    () => new Map((progression.data ?? []).map((s) => [s.entryId, s])),
    [progression.data],
  )

  if (session.error !== null) {
    return (
      <Screen testID="session-screen">
        <ErrorNotice message={session.error.message} />
      </Screen>
    )
  }
  if (session.isPending) return <Spinner testID="session-loading" />

  const logs = session.data.logs
  const ended = session.data.endedAt !== null

  return (
    <Screen
      title={day?.name ?? 'Session'}
      testID="session-screen"
      footer={
        ended ? (
          <Button
            title="Done"
            variant="secondary"
            onPress={() => {
              router.back()
            }}
            testID="leave-session"
          />
        ) : (
          <Button
            title="Finish session"
            onPress={() => {
              void submit(async () => {
                await finish.mutateAsync({ endedAt: new Date().toISOString() })
                router.back()
              })
            }}
            busy={busy}
            testID="finish-session"
          />
        )
      }
    >
      {error === null ? null : <Text tone="danger">{error}</Text>}

      {ended ? (
        <Text tone="muted" testID="session-finished">
          {`Finished. ${logs.length} ${logs.length === 1 ? 'set' : 'sets'} logged.`}
        </Text>
      ) : day === undefined ? (
        <Text tone="muted" testID="session-adhoc">
          Ad-hoc session. Open an exercise to log against it.
        </Text>
      ) : (
        day.entries.map((entry) => {
          const done = logs.filter((l) => l.entryId === entry.id && !l.isWarmup).length
          return (
            <SetLogger
              key={entry.id}
              exerciseName={entry.exercise?.name ?? 'Unavailable exercise'}
              tracking={entry.exercise?.tracking ?? 'weight_reps'}
              target={targetOf(entry)}
              suggestion={hintFor(suggestions.get(entry.id))}
              done={done}
              busy={logSet.isPending}
              testID={`log-entry-${entry.index}`}
              onLog={(values) => {
                void submit(async () => {
                  await logSet.mutateAsync({
                    exerciseId: entry.exerciseId,
                    entryId: entry.id,
                    setIndex: done,
                    weightG: values.weightG,
                    reps: values.reps,
                    rpe: null,
                    durationS: values.durationS,
                    distanceMm: values.distanceMm,
                    isWarmup: false,
                  })
                })
              }}
            />
          )
        })
      )}

      <LoggedSets
        logs={logs}
        editable={!ended}
        onRemove={(logId) => {
          removeLog.mutate(logId)
        }}
      />
    </Screen>
  )
}
