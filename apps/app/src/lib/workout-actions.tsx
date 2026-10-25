import { useRouter } from 'expo-router'
import type { Workout } from '@cedo/contract'
import {
  useDeleteWorkout,
  useDuplicateWorkout,
  useFavouriteWorkout,
  useSessions,
  useStartSession,
  useTransferWorkout,
} from '../api/queries.ts'
import { Button, Card, ConfirmButton, PinButton, Stack, Text } from '../ui/index.ts'
import { DuplicateIntoMyGroup } from './duplicate-into-my-group.tsx'
import { GroupPlacement } from './group-placement.tsx'
import type { DayDraft } from './plan-draft.ts'
import { useSubmit } from './use-submit.ts'

/**
 * What is done with a workout besides editing its plan (#26): starting a day of it, or resuming the
 * session in progress; pinning it, its group, deleting it; and, for a reader, a copy of their own.
 */

/**
 * Starting a day of a workout from its page — or, while a session is in progress, resuming that one
 * instead: one session runs at a time, and until it is known whether one does, the page offers
 * neither. A day not yet saved has no id to start from: it gets its Start once it is saved.
 */
export function useStartDay(workoutId: string) {
  const router = useRouter()
  const start = useStartSession()
  const { submit, busy, error } = useSubmit()
  const current = useSessions({ inProgress: true, limit: 1 })
  const open = current.data?.items[0]
  const known = current.data !== undefined

  return {
    error,
    resume:
      open === undefined
        ? undefined
        : () => {
            router.push(`/today/session/${open.id}`)
          },
    /** Start, beside the day at an index — or nothing, when it cannot be started yet. */
    startButton: (days: readonly DayDraft[]) =>
      known
        ? (index: number): React.ReactNode => {
            const dayId = days[index]?.id
            if (dayId === undefined) return null
            return (
              <Button
                title="Start"
                variant="secondary"
                size="small"
                busy={busy}
                onPress={() => {
                  void submit(async () => {
                    const session = await start.mutateAsync({ workoutId, dayId })
                    router.push(`/today/session/${session.id}`)
                  })
                }}
                testID={`start-day-${String(index)}`}
              />
            )
          }
        : null,
  }
}

/** While a session is in progress, the plan offers it back rather than a start the server refuses. */
export function InProgress({
  resume,
}: {
  readonly resume: (() => void) | undefined
}): React.JSX.Element | null {
  if (resume === undefined) return null
  return (
    <Card testID="workout-in-progress">
      <Stack gap="sm">
        <Text tone="muted">A session is in progress. Finish it before starting another.</Text>
        <Button title="Resume" onPress={resume} testID="workout-resume" />
      </Stack>
    </Card>
  )
}

/** A reader's way to change it: a copy, in their own group, opened on its own outline. */
export function CopyFooter({ workoutId }: { readonly workoutId: string }): React.JSX.Element {
  const duplicate = useDuplicateWorkout()
  return (
    <DuplicateIntoMyGroup
      duplicate={async () => await duplicate.mutateAsync(workoutId)}
      editorOf={(copyId) => `/workouts/${copyId}`}
      testID="duplicate-workout"
    />
  )
}

/**
 * What is done to a workout as a whole, under its outline (#26): pinning it, the group it is in, and
 * deleting it — asked twice; the sessions trained from it stay in history, no longer pointing at a
 * plan.
 */
export function WorkoutAdmin({
  workout,
  onDeleted,
}: {
  readonly workout: Workout
  readonly onDeleted: () => void
}): React.JSX.Element {
  const favourite = useFavouriteWorkout()
  const transfer = useTransferWorkout()
  const remove = useDeleteWorkout()
  // One submission each: pinning must not show the delete as busy.
  const pinning = useSubmit()
  const deleting = useSubmit()
  return (
    <Stack gap="md" testID="workout-admin">
      <Text variant="label" tone="muted">
        Workout
      </Text>
      <PinButton
        pinned={workout.isFavourite}
        busy={pinning.busy}
        error={pinning.error}
        onToggle={() => {
          void pinning.submit(async () => {
            await favourite.mutateAsync({ id: workout.id, on: !workout.isFavourite })
          })
        }}
        testID="workout-pin"
      />
      <GroupPlacement
        ownerGroupId={workout.ownerGroupId}
        canEdit={workout.canEdit}
        transfer={async (toGroupId) => await transfer.mutateAsync({ id: workout.id, toGroupId })}
        testID="workout-transfer"
      />
      {workout.canEdit ? (
        <ConfirmButton
          title="Delete workout"
          busy={deleting.busy}
          error={deleting.error}
          onConfirm={async () => {
            await deleting.submit(async () => {
              await remove.mutateAsync(workout.id)
              onDeleted()
            })
          }}
          testID="workout-delete"
        />
      ) : null}
    </Stack>
  )
}
