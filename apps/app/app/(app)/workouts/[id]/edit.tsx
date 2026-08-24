import { useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
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
  emptyDay,
  emptyEntry,
  moveItem,
  removeAt,
  replaceAt,
  toPlanInput,
} from '../../../../src/lib/plan-draft.ts'
import { ExercisePicker } from '../../../../src/lib/exercise-picker.tsx'
import { useExercises, useReplacePlan, useWorkout } from '../../../../src/api/queries.ts'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

export default function EditPlan(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const workout = useWorkout(id ?? '')
  const library = useExercises({ scope: 'all', limit: 100 })
  const replace = useReplacePlan(id ?? '')
  const { submit, busy, error } = useSubmit()

  const [days, setDays] = useState<DayDraft[] | null>(null)
  const [picking, setPicking] = useState<number | null>(null)

  const draft = days ?? (workout.data === undefined ? [] : draftFrom(workout.data))
  const names = useMemo(
    () => new Map((library.data?.items ?? []).map((e) => [e.id, e.name])),
    [library.data],
  )

  const save = () => {
    void submit(async () => {
      await replace.mutateAsync(toPlanInput(draft))
      router.back()
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
        onPick={(exerciseId) => {
          const day = draft[picking]
          if (day !== undefined) {
            setDays(
              replaceAt(draft, picking, {
                ...day,
                entries: [...day.entries, emptyEntry(exerciseId)],
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
        <Stack direction="row" gap="sm">
          <Button
            title="Add day"
            variant="secondary"
            grow
            onPress={() => {
              setDays([...draft, emptyDay(draft.length)])
            }}
            testID="add-day"
          />
          <Button title="Save plan" grow onPress={save} busy={busy} testID="save-plan" />
        </Stack>
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
            exerciseNames={names}
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
