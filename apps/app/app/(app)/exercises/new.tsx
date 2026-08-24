import { ExerciseForm } from '../../../src/lib/exercise-form.tsx'
import { useCreateExercise } from '../../../src/api/queries.ts'

export default function NewExercise(): React.JSX.Element {
  const create = useCreateExercise()
  return (
    <ExerciseForm
      title="New exercise"
      testID="exercise-new-screen"
      onSave={async (input) => {
        await create.mutateAsync(input)
      }}
    />
  )
}
