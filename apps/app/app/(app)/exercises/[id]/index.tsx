import { Redirect, useLocalSearchParams } from 'expo-router'

/**
 * One exercise, by its address: the library with it open (#29) — beside the list on a desktop, in a
 * sheet over it on a phone — where an exercise is read, and put away again.
 */
export default function ExerciseDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Redirect href={`/exercises?open=${id ?? ''}`} />
}
