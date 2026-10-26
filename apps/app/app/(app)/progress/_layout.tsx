import { Stack } from 'expo-router'

/** Each tab owns a stack, so pushing a detail screen keeps the tab bar and the back gesture. */
export default function TabStack(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />
}
