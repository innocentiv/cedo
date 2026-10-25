import { useLocalSearchParams } from 'expo-router'
import { ErrorNotice, Screen, Spinner } from '../../../../src/ui/index.ts'
import { useWorkout } from '../../../../src/api/queries.ts'
import { useGoBack } from '../../../../src/lib/use-go-back.ts'
import { WorkoutBody } from '../../../../src/lib/workout-page.tsx'

/** A workout, by its address: read, then its page (`workout-page.tsx`). */
export default function WorkoutPage(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const workout = useWorkout(id ?? '')
  const goBack = useGoBack('/workouts')
  if (workout.error !== null) {
    return (
      <Screen testID="workout-detail-screen">
        <ErrorNotice
          message={workout.error.message}
          onRetry={() => {
            void workout.refetch()
          }}
        />
      </Screen>
    )
  }
  if (workout.isPending) return <Spinner testID="workout-loading" />
  return (
    <WorkoutBody
      workout={workout.data}
      reread={async () => (await workout.refetch()).data}
      goBack={goBack}
    />
  )
}
