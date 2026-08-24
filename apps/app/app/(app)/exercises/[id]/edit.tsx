import { useLocalSearchParams } from 'expo-router'
import { ErrorNotice, Screen, Spinner } from '../../../../src/ui/index.ts'
import { ExerciseForm } from '../../../../src/lib/exercise-form.tsx'
import { useExercise, useUpdateExercise } from '../../../../src/api/queries.ts'

export default function EditExercise(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isPending, error } = useExercise(id ?? '')
  const update = useUpdateExercise(id ?? '')

  if (error !== null) {
    return (
      <Screen testID="exercise-edit-screen">
        <ErrorNotice message={error.message} />
      </Screen>
    )
  }
  if (isPending) return <Spinner testID="exercise-edit-loading" />

  return (
    <ExerciseForm
      title="Edit exercise"
      testID="exercise-edit-screen"
      initial={data}
      onSave={async (input) => {
        await update.mutateAsync(input)
      }}
    />
  )
}
