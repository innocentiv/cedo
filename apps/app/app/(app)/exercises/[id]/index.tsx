import { useLocalSearchParams } from 'expo-router'
import { ExerciseDetailView } from '../../../../src/lib/exercise-detail.tsx'
import { useGoBack } from '../../../../src/lib/use-go-back.ts'

/** One exercise, by its address: a screen of its own (`ExerciseDetailView`). */
export default function ExerciseDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const goBack = useGoBack('/exercises')
  return <ExerciseDetailView id={id ?? ''} onGone={goBack} />
}
