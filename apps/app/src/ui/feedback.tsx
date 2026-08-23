import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { color, space } from './tokens.ts'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { Button } from './button.tsx'

export function Spinner({ testID }: { readonly testID?: string | undefined }): React.JSX.Element {
  return (
    <View testID={testID} style={styles.centre}>
      <ActivityIndicator color={color.accent} />
    </View>
  )
}

export interface EmptyProps {
  readonly title: string
  readonly detail?: string | undefined
  readonly action?: { readonly title: string; readonly onPress: () => void }
  readonly testID?: string | undefined
}

/** Empty states are a designed screen, not an accident. Every list has one. */
export function Empty({ title, detail, action, testID }: EmptyProps): React.JSX.Element {
  return (
    <Stack gap="md" align="center" justify="center" testID={testID} style={styles.centre}>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {detail === undefined ? null : (
        <Text tone="muted" align="center">
          {detail}
        </Text>
      )}
      {action === undefined ? null : (
        <Button title={action.title} onPress={action.onPress} variant="secondary" />
      )}
    </Stack>
  )
}

export interface FormErrorProps {
  /** Null renders nothing, so a call site never needs a conditional around it. */
  readonly message: string | null
  readonly testID?: string | undefined
}

/** The whole-form error line, above the submit button. Every form shows failures the same way. */
export function FormError({ message, testID }: FormErrorProps): React.JSX.Element | null {
  if (message === null) return null
  return (
    <Text tone="danger" testID={testID}>
      {message}
    </Text>
  )
}

export interface ErrorNoticeProps {
  readonly message: string
  readonly onRetry?: (() => void) | undefined
  readonly testID?: string | undefined
}

/**
 * A failed request, rendered where the content would have been. `testID="error-notice"` so the
 * WebView harness can assert its absence on a healthy route. See docs/10-testing.md.
 */
export function ErrorNotice({
  message,
  onRetry,
  testID = 'error-notice',
}: ErrorNoticeProps): React.JSX.Element {
  return (
    <Stack gap="md" align="center" justify="center" testID={testID} style={styles.centre}>
      <Text tone="danger" align="center">
        {message}
      </Text>
      {onRetry === undefined ? null : (
        <Button title="Try again" onPress={onRetry} variant="secondary" />
      )}
    </Stack>
  )
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
})
