import { useMemo } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Slot } from 'expo-router'
import { StatusBar } from 'react-native'
import { createQueryClient } from '../src/api/query-client.ts'
import { AuthProvider } from '../src/auth/auth-provider.tsx'
import { ErrorBoundary } from '../src/ui/index.ts'

/**
 * The one place providers are mounted. Everything below is a route.
 *
 * `ErrorBoundary` is outermost so a crash in a provider still renders a readable message rather
 * than a blank page — a blank page tells whoever is iterating nothing at all.
 * See docs/08-frontend.md.
 */
export default function RootLayout(): React.JSX.Element {
  const queryClient = useMemo(() => createQueryClient(), [])

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {/* No `backgroundColor`: React Native 0.88 removed it. Android draws edge to edge, so
                the screen's own background shows behind the status bar. */}
            <StatusBar barStyle="light-content" />
            <Slot />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  )
}
