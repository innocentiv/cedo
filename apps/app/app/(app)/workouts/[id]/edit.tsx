import { useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { useGoBack } from '../../../../src/lib/use-go-back.ts'
import {
  Button,
  DayEditor,
  ErrorNotice,
  FormError,
  Screen,
  Spinner,
  Stack,
  Text,
} from '../../../../src/ui/index.ts'
import {
  type DayDraft,
  draftFrom,
  moveItem,
  removeAt,
  replaceAt,
  toPlanInput,
} from '../../../../src/lib/plan-draft.ts'
import { ExercisePicker } from '../../../../src/lib/exercise-picker.tsx'
import { type Exercise, canAddDay, newDay, newEntry, planIssues } from '@cedo/contract'
import { useReplacePlan, useWorkout } from '../../../../src/api/queries.ts'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

export default function EditPlan(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const goBack = useGoBack('/workouts')
  const workout = useWorkout(id ?? '')
  const replace = useReplacePlan(id ?? '')
  const { submit, busy, error } = useSubmit()

  const [days, setDays] = useState<DayDraft[] | null>(null)
  const [picking, setPicking] = useState<number | null>(null)
  const [picked, setPicked] = useState<ReadonlyMap<string, Exercise>>(new Map())

  const draft = days ?? (workout.data === undefined ? [] : draftFrom(workout.data))
  /**
   * Every exercise the draft can reference: the ones the plan already resolves, plus any picked
   * while editing. It used to be the first 100 of the library — the contract's page limit — so past
   * that, or for anything found by search, an entry showed as "Exercise" with weight-and-reps
   * inputs, and a plank lost its Seconds field.
   */
  const byId = useMemo(() => {
    const known = new Map<string, Exercise>()
    for (const day of workout.data?.days ?? []) {
      for (const entry of day.entries) {
        if (entry.exercise !== null) known.set(entry.exerciseId, entry.exercise)
      }
    }
    for (const [exerciseId, exercise] of picked) known.set(exerciseId, exercise)
    return known
  }, [workout.data, picked])

  /**
   * The schema's verdict on the draft, read as it is edited rather than after a refused save. An
   * empty plan has its own hint below, so it is not listed twice.
   */
  const issues = draft.length === 0 ? [] : planIssues(toPlanInput(draft), byId)

  const save = () => {
    void submit(async () => {
      await replace.mutateAsync(toPlanInput(draft))
      goBack()
    })
  }

  if (workout.error !== null) {
    return (
      <Screen testID="plan-edit-screen">
        <ErrorNotice message={workout.error.message} />
      </Screen>
    )
  }
  if (workout.isPending) return <Spinner testID="plan-edit-loading" />

  if (picking !== null) {
    return (
      <ExercisePicker
        onCancel={() => {
          setPicking(null)
        }}
        onPick={(exercise) => {
          setPicked(new Map(picked).set(exercise.id, exercise))
          const day = draft[picking]
          if (day !== undefined) {
            setDays(
              replaceAt(draft, picking, {
                ...day,
                entries: [...day.entries, newEntry(exercise)],
              }),
            )
          }
          setPicking(null)
        }}
      />
    )
  }

  return (
    <Screen
      title={`Edit ${workout.data.name}`}
      testID="plan-edit-screen"
      footer={
        <PlanFooter
          issues={issues}
          addDayAllowed={canAddDay(draft)}
          canSave={draft.length > 0 && issues.length === 0}
          onAddDay={() => {
            setDays([...draft, newDay(draft.length)])
          }}
          onSave={save}
          busy={busy}
        />
      }
    >
      <FormError message={error} testID="plan-edit-error" />

      {draft.length === 0 ? (
        <Text tone="muted">Add a day to start building the plan.</Text>
      ) : (
        draft.map((day, dayIndex) => (
          <DayEditor
            key={`day-${dayIndex}`}
            day={day}
            index={dayIndex}
            library={byId}
            onChange={(next) => {
              setDays(replaceAt(draft, dayIndex, next))
            }}
            onMoveUp={() => {
              setDays(moveItem(draft, dayIndex, dayIndex - 1))
            }}
            onRemove={() => {
              setDays(removeAt(draft, dayIndex))
            }}
            onAddEntry={() => {
              setPicking(dayIndex)
            }}
          />
        ))
      )}
    </Screen>
  )
}

/**
 * Add a day, save — and, while the draft would be refused, why. Both buttons stop where the schema
 * would: no fifteenth day, no save of a draft with issues.
 */
function PlanFooter({
  issues,
  addDayAllowed,
  canSave,
  onAddDay,
  onSave,
  busy,
}: {
  readonly issues: readonly string[]
  readonly addDayAllowed: boolean
  readonly canSave: boolean
  readonly onAddDay: () => void
  readonly onSave: () => void
  readonly busy: boolean
}): React.JSX.Element {
  return (
    <Stack gap="xs">
      {issues.length === 0 ? null : (
        <Stack gap="xs" testID="plan-issues">
          {/* Three at most: the footer stays a footer. Fixing one shows the next. */}
          {issues.slice(0, 3).map((issue) => (
            <Text key={issue} variant="caption" tone="danger">
              {issue}
            </Text>
          ))}
          {issues.length > 3 ? (
            <Text variant="caption" tone="danger">{`…and ${issues.length - 3} more`}</Text>
          ) : null}
        </Stack>
      )}
      <Stack direction="row" gap="sm">
        <Button
          title="Add day"
          variant="secondary"
          grow
          disabled={!addDayAllowed}
          onPress={onAddDay}
          testID="add-day"
        />
        <Button
          title="Save plan"
          grow
          disabled={!canSave}
          onPress={onSave}
          busy={busy}
          testID="save-plan"
        />
      </Stack>
    </Stack>
  )
}
