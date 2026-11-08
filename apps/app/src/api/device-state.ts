import { AppState, Platform } from 'react-native'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { addNetworkStateListener } from 'expo-network'

/**
 * Whether the device has a signal, and whether the app is in front, as TanStack Query reads them:
 * a set logged without a signal waits for the first (#9), and reads are refreshed on the second.
 *
 * The web needs nothing here: TanStack listens to the browser's `online` and `offline` events and to
 * the page's visibility itself. React Native has neither. TanStack's default finds a `window`
 * without `addEventListener` and reports online for good, so a set logged without a signal was not
 * held for the signal but sent until its sends ran out (`retry.ts`), and dropped. On native both are
 * wired as TanStack documents for React Native: the network to expo-network, being in front to
 * `AppState` (#77).
 */
export function watchDeviceState(): void {
  if (Platform.OS === 'web') return
  onlineManager.setEventListener((setOnline) => {
    const subscription = addNetworkStateListener(({ isConnected }) => {
      setOnline(isConnected === true)
    })
    return () => {
      subscription.remove()
    }
  })
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => {
      setFocused(state === 'active')
    })
    return () => {
      subscription.remove()
    }
  })
}
