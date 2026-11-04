import { useState } from 'react'
import { type Workout, type WorkoutUpdate, nameToKeep } from '@cedo/contract'
import { useUpdateWorkout } from '../api/queries.ts'
import { IconButton, Input, Stack, Text } from '../ui/index.ts'
import type { PlanEditor } from './use-plan-editor.ts'
import { useSubmit } from './use-submit.ts'
import { WrittenNotes } from './written-notes.tsx'

/** Keeps a change to a workout's name or notes, and says why when it is refused. */
function useWorkoutPatch(workoutId: string): {
  readonly keep: (patch: WorkoutUpdate) => void
  readonly error: string | null
} {
  const update = useUpdateWorkout(workoutId)
  const { submit, error } = useSubmit()
  return {
    keep: (patch) => {
      void submit(async () => {
        await update.mutateAsync(patch)
      })
    },
    error,
  }
}

/**
 * A workout's page's heading (#26): back, and its name — edited where it is read, kept as the field
 * is left. The screen's heading, as any screen's title is: on a desktop across both columns, pinned
 * above them, never cut to the width of the outline.
 */
export function WorkoutTitle({
  workout,
  canEdit,
  onBack,
}: {
  readonly workout: Workout
  readonly canEdit: boolean
  readonly onBack: () => void
}): React.JSX.Element {
  const { keep, error } = useWorkoutPatch(workout.id)
  const [name, setName] = useState(workout.name)
  return (
    <Stack gap="xs">
      <Stack direction="row" align="center" gap="sm">
        <IconButton
          name="back"
          label="Back"
          edge="start"
          tone="default"
          onPress={onBack}
          testID="workout-back"
        />
        <Stack grow>
          {canEdit ? (
            <Input
              value={name}
              onChangeText={setName}
              autoCapitalize="sentences"
              look="title"
              onBlur={() => {
                const kept = nameToKeep(name, workout.name)
                if (kept === undefined) setName(workout.name)
                else keep({ name: kept })
              }}
              testID="workout-name-edit"
            />
          ) : (
            <Text variant="title">{workout.name}</Text>
          )}
        </Stack>
      </Stack>
      {error === null ? null : (
        <Text variant="caption" tone="danger" testID="workout-name-error">
          {error}
        </Text>
      )}
    </Stack>
  )
}

/**
 * The workout's notes show this many lines above its plan before Show all (#51): an AI's notes run
 * to a page, and the plan is what the page is for.
 */
const NOTES_FOLD = 6

/**
 * The head of a workout's outline (#26): its notes — read first, written on request, kept as the
 * field is left (#51) — and what is true of the plan below: saved, saving, or why not.
 */
export function WorkoutHead({
  workout,
  status,
}: {
  readonly workout: Workout
  /** Null for a reader: nothing they do is saved. */
  readonly status: PlanEditor['status'] | null
}): React.JSX.Element {
  const { keep, error } = useWorkoutPatch(workout.id)

  return (
    <Stack gap="sm">
      <WrittenNotes
        notes={workout.notes}
        onKeep={(notes) => {
          keep({ notes })
        }}
        canEdit={status !== null}
        placeholder="How this workout is run: effort, progression, a bad day"
        fold={NOTES_FOLD}
        testID="workout-notes"
      />
      {error === null ? null : (
        <Text variant="caption" tone="danger" testID="workout-head-error">
          {error}
        </Text>
      )}
      {status === null ? null : <PlanStatus status={status} />}
    </Stack>
  )
}

/**
 * What is true of the plan on screen: saved; on its way; kept here, unsent, because the schema would
 * refuse it — and why, three reasons at most; or put back, because the server refused it.
 */
function PlanStatus({ status }: { readonly status: PlanEditor['status'] }): React.JSX.Element {
  const { issues, said, saving, unsaved } = status
  return (
    <Stack gap="xs">
      <Text variant="caption" tone={issues.length > 0 ? 'danger' : 'muted'} testID="plan-status">
        {saving ? 'Saving…' : unsaved ? 'Not saved' : 'Saved'}
      </Text>
      {said === null ? null : (
        <Text variant="caption" tone="danger" testID="plan-said">
          {said}
        </Text>
      )}
      {issues.length === 0 ? null : (
        <Stack gap="xs" testID="plan-issues">
          {issues.slice(0, 3).map((issue) => (
            <Text key={issue} variant="caption" tone="danger">
              {issue}
            </Text>
          ))}
          {issues.length > 3 ? (
            <Text variant="caption" tone="danger">{`…and ${String(issues.length - 3)} more`}</Text>
          ) : null}
        </Stack>
      )}
    </Stack>
  )
}
