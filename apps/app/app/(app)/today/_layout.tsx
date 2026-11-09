import { Stack } from 'expo-router'
import { useRestAlertTaps } from '../../../src/lib/rest-alert-device.ts'

/**
 * Each tab owns a stack, so pushing a detail screen keeps the tab bar and the back gesture. Today's
 * holds the session, where a tap on a rest's end told with the app closed goes (#39).
 */
export default function TabStack(): React.JSX.Element {
  useRestAlertTaps()
  return <Stack screenOptions={{ headerShown: false }} />
}
