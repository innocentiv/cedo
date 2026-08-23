import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Screen } from './screen.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { Button } from './button.tsx'

interface Props {
  readonly children: ReactNode
}

interface State {
  readonly error: Error | null
}

/**
 * The last line of defence, and a deliberate part of the verification loop.
 *
 * It renders the message with `testID="error-boundary"` so a WebView run can see it in BOTH a
 * screenshot and an `evaluate` query, and re-throws it into `console.error` so the harness fails
 * even on a route nobody wrote an assertion for. See docs/10-testing.md.
 *
 * A class component because React offers no hook equivalent; this is the only one in the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[error-boundary]', error.message, info.componentStack ?? '')
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    return (
      <Screen scroll={false} testID="error-boundary">
        <Stack gap="md" grow justify="center">
          <Text variant="heading" tone="danger">
            Something broke
          </Text>
          <Text tone="muted" testID="error-boundary-message">
            {error.message}
          </Text>
          <Button
            title="Try again"
            variant="secondary"
            onPress={() => {
              this.setState({ error: null })
            }}
          />
        </Stack>
      </Screen>
    )
  }
}
