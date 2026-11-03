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
import { Button, Card, ConfirmButton, Stack, Text } from '../ui/index.ts'
import { DuplicateIntoMyGroup } from './duplicate-into-my-group.tsx'
import { OwnershipLine, usePinning } from './ownership-line.tsx'
import { useSubmit } from './use-submit.ts'

/**
 * Starting a day of a workout from its page (#26) — or, while a session is in progress, resuming that
 * one instead: one session runs at a time, and until it is known whether one does, the page offers
 * neither.
 */
export function useStartDay(workoutId: string) {
  const router = useRouter()
  const start = useStartSession()
  const { submit, busy, error } = useSubmit()
  const current = useSessions({ inProgress: true, limit: 1 })
  const open = current.data?.items[0]
  return {
    error,
    busy,
    resume:
      open === undefined
        ? undefined
        : () => {
            router.push(`/today/session/${open.id}`)
          },
    /** A day started, by its id — null while a session runs, or before it is known whether one does. */
    start:
      current.data === undefined || open !== undefined
        ? null
        : (dayId: string) => {
            void submit(async () => {
              const session = await start.mutateAsync({ workoutId, dayId })
              router.push(`/today/session/${session.id}`)
            })
          },
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
 * Under a workout's name (#26): which group it is in, then a star pinning it and a transfer to
 * another group — one quiet line, both rarely used.
 */
export function WorkoutOwnership({ workout }: { readonly workout: Workout }): React.JSX.Element {
  const transfer = useTransferWorkout()
  const pinning = usePinning(useFavouriteWorkout(), workout, 'workout-pin')
  return (
    <OwnershipLine
      ownerGroupId={workout.ownerGroupId}
      canEdit={workout.canEdit}
      transfer={async (toGroupId) => await transfer.mutateAsync({ id: workout.id, toGroupId })}
      pin={pinning}
      testID="workout-transfer"
    />
  )
}

/**
 * Deleting a workout, under its outline (#26) — asked twice; the sessions trained from it stay in
 * history, no longer pointing at a plan. Only for who edits it.
 */
export function DeleteWorkout({
  workoutId,
  onDeleted,
}: {
  readonly workoutId: string
  readonly onDeleted: () => void
}): React.JSX.Element {
  const remove = useDeleteWorkout()
  const { submit, busy, error } = useSubmit()
  return (
    <ConfirmButton
      title="Delete workout"
      busy={busy}
      error={error}
      onConfirm={async () => {
        await submit(async () => {
          await remove.mutateAsync(workoutId)
          onDeleted()
        })
      }}
      testID="workout-delete"
    />
  )
}
