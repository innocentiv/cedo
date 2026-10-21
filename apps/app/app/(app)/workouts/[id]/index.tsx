import { useLocalSearchParams, useRouter } from 'expo-router'
import { exerciseName } from '../../../../src/lib/exercise-name.ts'
import { formatPrescription } from '@cedo/contract'
import type { WorkoutDay, WorkoutSessionSummary } from '@cedo/contract'
import { useWeightUnit } from '../../../../src/lib/weight-unit.ts'
import {
  Button,
  Card,
  ConfirmButton,
  ErrorNotice,
  Loaded,
  NavButton,
  PinButton,
  Screen,
  Spinner,
  Stack,
  Text,
} from '../../../../src/ui/index.ts'
import {
  useDeleteWorkout,
  useFavouriteWorkout,
  useSessions,
  useStartSession,
  useTransferWorkout,
  useWorkout,
} from '../../../../src/api/queries.ts'
import { GroupPlacement } from '../../../../src/lib/group-placement.tsx'
import { useGoBack } from '../../../../src/lib/use-go-back.ts'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

export default function WorkoutDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { data, isPending, error, refetch } = useWorkout(id ?? '')
  const start = useStartSession()
  const favourite = useFavouriteWorkout()
  const transfer = useTransferWorkout()
  const remove = useDeleteWorkout()
  const goBack = useGoBack('/workouts')
  // One submission each: pinning must not show the delete as busy, nor a refused delete as a
  // refused start.
  const { submit, busy, error: startError } = useSubmit()
  const pinning = useSubmit()
  const deleting = useSubmit()
  // One session is in progress at a time: while one is, the plan offers it back rather than a start
  // the server would refuse — and, until it is known whether one is, offers neither.
  const current = useSessions({ inProgress: true, limit: 1 })

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
      <PinButton
        pinned={data.isFavourite}
        busy={pinning.busy}
        error={pinning.error}
        onToggle={() => {
          void pinning.submit(async () => {
            await favourite.mutateAsync({ id: data.id, on: !data.isFavourite })
          })
        }}
        testID="workout-pin"
      />
      <GroupPlacement
        ownerGroupId={data.ownerGroupId}
        canEdit={data.canEdit}
        transfer={async (toGroupId) => await transfer.mutateAsync({ id: data.id, toGroupId })}
        testID="workout-transfer"
      />
      <Loaded query={current} testID="workout-current">
        {({ items: [inProgress] }) => (
          <Days
            days={data.days}
            inProgress={inProgress}
            busy={busy}
            onStart={begin}
            onResume={(sessionId) => {
              router.push(`/today/session/${sessionId}`)
            }}
          />
        )}
      </Loaded>
      {data.canEdit ? (
        // The sessions trained from it stay in history, no longer pointing at a plan.
        <ConfirmButton
          title="Delete workout"
          busy={deleting.busy}
          error={deleting.error}
          onConfirm={async () => {
            await deleting.submit(async () => {
              await remove.mutateAsync(data.id)
              goBack()
            })
          }}
          testID="workout-delete"
        />
      ) : null}
    </Screen>
  )
}

/**
 * The plan's days, each with what can be done from it now: Start — or, while a session is in
 * progress, nothing, and that session offered back above them.
 */
function Days({
  days,
  inProgress,
  busy,
  onStart,
  onResume,
}: {
  readonly days: readonly WorkoutDay[]
  readonly inProgress: WorkoutSessionSummary | undefined
  readonly busy: boolean
  readonly onStart: (day: WorkoutDay) => void
  readonly onResume: (sessionId: string) => void
}): React.JSX.Element {
  const unit = useWeightUnit()
  return (
    <>
      {inProgress === undefined ? null : (
        <Card testID="workout-in-progress">
          <Stack gap="sm">
            <Text tone="muted">A session is in progress. Finish it before starting another.</Text>
            <Button
              title="Resume"
              onPress={() => {
                onResume(inProgress.id)
              }}
              testID="workout-resume"
            />
          </Stack>
        </Card>
      )}
      {days.length === 0 ? (
        <Text tone="muted">This plan has no days yet.</Text>
      ) : (
        days.map((day) => (
          <Card key={day.id} testID={`workout-day-${day.index}`}>
            <Stack gap="md">
              <Stack direction="row" gap="sm" align="center">
                <Stack grow>
                  <Text variant="heading">{day.name}</Text>
                </Stack>
                {inProgress === undefined ? (
                  <Button
                    title="Start"
                    onPress={() => {
                      onStart(day)
                    }}
                    busy={busy}
                    testID={`start-day-${day.index}`}
                  />
                ) : null}
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
    </>
  )
}
