import { useLocalSearchParams, useRouter } from 'expo-router'
import { exerciseName } from '../../../../src/lib/exercise-name.ts'
import { formatPrescription } from '@cedo/contract'
import type { WorkoutDay } from '@cedo/contract'
import { useWeightUnit } from '../../../../src/lib/weight-unit.ts'
import {
  Button,
  Card,
  ErrorNotice,
  NavButton,
  Screen,
  Spinner,
  Stack,
  Text,
} from '../../../../src/ui/index.ts'
import { useSessions, useStartSession, useWorkout } from '../../../../src/api/queries.ts'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

export default function WorkoutDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { data, isPending, error, refetch } = useWorkout(id ?? '')
  const unit = useWeightUnit()
  const start = useStartSession()
  const { submit, busy, error: startError } = useSubmit()
  // One session is in progress at a time: while one is, a day offers it back rather than a start
  // the server would refuse — and offers nothing until it is known whether one is.
  const current = useSessions({ inProgress: true, limit: 1 })
  const inProgress = current.data?.items[0]

  const begin = (day: WorkoutDay) => {
    void submit(async () => {
      const session = await start.mutateAsync({ workoutId: id ?? null, dayId: day.id })
      router.push(`/today/session/${session.id}`)
    })
  }

  if (error !== null) {
    return (
      <Screen testID="workout-detail-screen">
        <ErrorNotice
          message={error.message}
          onRetry={() => {
            void refetch()
          }}
        />
      </Screen>
    )
  }
  if (isPending) return <Spinner testID="workout-loading" />

  return (
    <Screen
      title={data.name}
      testID="workout-detail-screen"
      footer={
        data.canEdit ? (
          <NavButton
            title="Edit plan"
            href={`/workouts/${data.id}/edit`}
            variant="primary"
            testID="edit-workout"
          />
        ) : undefined
      }
    >
      {startError === null ? null : <Text tone="danger">{startError}</Text>}
      {inProgress === undefined ? null : (
        <Card testID="workout-in-progress">
          <Stack gap="sm">
            <Text tone="muted">A session is in progress. Finish it before starting another.</Text>
            <Button
              title="Resume"
              onPress={() => {
                router.push(`/today/session/${inProgress.id}`)
              }}
              testID="resume-session"
            />
          </Stack>
        </Card>
      )}

      {data.days.length === 0 ? (
        <Text tone="muted">This plan has no days yet.</Text>
      ) : (
        data.days.map((day) => (
          <Card key={day.id} testID={`workout-day-${day.index}`}>
            <Stack gap="md">
              <Stack direction="row" gap="sm" align="center">
                <Stack grow>
                  <Text variant="heading">{day.name}</Text>
                </Stack>
                {current.data === undefined || inProgress !== undefined ? null : (
                  <Button
                    title="Start"
                    onPress={() => {
                      begin(day)
                    }}
                    busy={busy}
                    testID={`start-day-${day.index}`}
                  />
                )}
              </Stack>

              {day.entries.map((entry) => (
                <Stack key={entry.id} gap="xs">
                  <Text variant="label">
                    {entry.supersetGroup === null ? '' : `${entry.supersetGroup} · `}
                    {exerciseName(entry.exercise)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {formatPrescription(entry.sets, entry.exercise?.tracking ?? null, unit)}
                    {entry.progression.kind === 'none' ? '' : ` · ${entry.progression.kind}`}
                  </Text>
                </Stack>
              ))}
            </Stack>
          </Card>
        ))
      )}
    </Screen>
  )
}
