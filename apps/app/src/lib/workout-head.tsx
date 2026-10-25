import { useState } from 'react'
import { type Workout, notesToKeep } from '@cedo/contract'
import { useUpdateWorkout } from '../api/queries.ts'
import { IconButton, Input, Stack, Text } from '../ui/index.ts'
import type { PlanEditor } from './use-plan-editor.ts'
import { useSubmit } from './use-submit.ts'

/**
 * The head of a workout's page (#26): back, its name and notes — edited where they are read, kept
 * as each field is left — and what is true of the plan below: saved, saving, or why not.
 */
export function WorkoutHead({
  workout,
  status,
  onBack,
}: {
  readonly workout: Workout
  /** Null for a reader: nothing they do is saved. */
  readonly status: PlanEditor['status'] | null
  readonly onBack: () => void
}): React.JSX.Element {
  const update = useUpdateWorkout(workout.id)
  const { submit, error } = useSubmit()
  const [name, setName] = useState(workout.name)
  const [notes, setNotes] = useState(workout.notes ?? '')
  const keep = (patch: { name?: string; notes?: string | null }) => {
    void submit(async () => {
      await update.mutateAsync(patch)
    })
  }
  const canEdit = status !== null

  return (
    <Stack gap="sm">
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
                const said = name.trim()
                if (said === '') setName(workout.name)
                else if (said !== workout.name) keep({ name: said })
              }}
              testID="workout-name-edit"
            />
          ) : (
            <Text variant="title">{workout.name}</Text>
          )}
        </Stack>
      </Stack>
      {canEdit ? (
        <Input
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes for this workout"
          multiline
          onBlur={() => {
            const kept = notesToKeep(notes, workout.notes)
            if (kept !== undefined) keep({ notes: kept })
          }}
          testID="workout-notes"
        />
      ) : workout.notes === null ? null : (
        <Text tone="muted">{workout.notes}</Text>
      )}
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
