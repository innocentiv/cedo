import { Redirect, useLocalSearchParams } from 'expo-router'
import { ExerciseDetailView } from '../../../../src/lib/exercise-detail.tsx'
import { useGoBack } from '../../../../src/lib/use-go-back.ts'
import { useLayout } from '../../../../src/ui/index.ts'

/**
 * One exercise, by its address: a screen of its own on a phone; on a desktop, the library with it
 * open beside the list (#29), where an exercise is read.
 */
export default function ExerciseDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  const goBack = useGoBack('/exercises')
  if (useLayout() === 'tablet') return <Redirect href={`/exercises?open=${id ?? ''}`} />
  return <ExerciseDetailView id={id ?? ''} onGone={goBack} />
}
