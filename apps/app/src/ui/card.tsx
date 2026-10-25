import { Pressable, StyleSheet, View } from 'react-native'
import { ROW_HEIGHT, color, radius, space } from './tokens.ts'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

export interface CardProps {
  readonly children: React.ReactNode
  readonly onPress?: (() => void) | undefined
  readonly testID?: string | undefined
}

export function Card({ children, onPress, testID }: CardProps): React.JSX.Element {
  if (onPress === undefined) {
    return (
      <View testID={testID} style={styles.card}>
        {children}
      </View>
    )
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  )
}

export interface ListRowProps {
  readonly title: string
  readonly subtitle?: string | undefined
  /** Short right-hand value — a weight, a count, a date. Never a sentence. */
  readonly trailing?: string | undefined
  readonly onPress?: (() => void) | undefined
  readonly accessory?: React.ReactNode | undefined
  readonly testID?: string | undefined
}

/**
 * The single row shape every list in the app uses: a line on the floor, not a box — a list of boxes
 * is a wall of borders the eye has to read past to the names in them.
 */
export function ListRow({
  title,
  subtitle,
  trailing,
  onPress,
  accessory,
  testID,
}: ListRowProps): React.JSX.Element {
  const content = (
    <Stack direction="row" gap="md" align="center">
      <Stack gap="xs" grow>
        <Text variant="label" numberOfLines={1}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </Stack>
      {trailing === undefined ? null : (
        <Text variant="mono" tone="muted">
          {trailing}
        </Text>
      )}
      {accessory}
    </Stack>
  )
  if (onPress === undefined) {
    return (
      <View testID={testID} style={styles.row}>
        {content}
      </View>
    )
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  pressed: { backgroundColor: color.surfaceRaised },
  row: {
    minHeight: ROW_HEIGHT,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  rowPressed: { backgroundColor: color.surface },
})
