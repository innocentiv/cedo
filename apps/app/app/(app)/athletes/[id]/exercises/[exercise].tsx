import { useLocalSearchParams } from 'expo-router'
import { Loaded, Screen } from '../../../../../src/ui/index.ts'
import { useExercise } from '../../../../../src/api/queries.ts'
import { useAthleteExerciseHistory } from '../../../../../src/api/athlete-queries.ts'
import { RecentHistory } from '../../../../../src/lib/exercise-about.tsx'

/**
 * An athlete's history of one exercise, read by their coach (#30): its trend and their sessions of
 * it. Only of an exercise the coach can see — one they cannot has no name, and no way here. No Pin,
 * Edit or Duplicate: this is the athlete's, read.
 */
export default function AthleteExercise(): React.JSX.Element {
  const { id, exercise: exerciseId } = useLocalSearchParams<{ id: string; exercise: string }>()
  const exercise = useExercise(exerciseId ?? '')
  const history = useAthleteExerciseHistory(id ?? '', exerciseId ?? '')
  return (
    <Loaded query={exercise} testID="athlete-exercise">
      {(data) => (
        <Screen title={data.name} testID="athlete-exercise-screen">
          <RecentHistory
            query={history}
            tracking={data.tracking}
            sessionHref={(sessionId) => `/athletes/${id ?? ''}/sessions/${sessionId}`}
          />
        </Screen>
      )}
    </Loaded>
  )
}
