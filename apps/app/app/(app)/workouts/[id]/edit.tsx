import { Redirect, useLocalSearchParams } from 'expo-router'

/**
 * Where the plan editor was. A workout is edited in place on its own page now (#26, ADR-0022), so
 * an old link — a bookmark, a copy just made — lands there.
 */
export default function EditPlan(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Redirect href={`/workouts/${id ?? ''}`} />
}
