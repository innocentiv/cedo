import { Redirect, useLocalSearchParams } from 'expo-router'
import { AthleteView } from '../../../../src/lib/athlete.tsx'
import { useLayout } from '../../../../src/ui/index.ts'

/**
 * One athlete, by their address: a screen of its own on a phone; on a desktop, the athletes with
 * them open beside the list (#30), as an exercise opens in the library.
 */
export default function AthleteDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>()
  if (useLayout() === 'tablet') return <Redirect href={`/athletes?open=${id ?? ''}`} />
  return <AthleteView id={id ?? ''} />
}
