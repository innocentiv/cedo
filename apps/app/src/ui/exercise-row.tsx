import { Pressable, StyleSheet, View } from 'react-native'
import { Icon } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { Thumbnail } from './thumbnail.tsx'
import { ROW_HEIGHT, ROW_THUMB_WIDTH, color, radius, space } from './tokens.ts'

/**
 * An exercise in a list (#27): its picture — its video's thumbnail, or a quiet slot with its initial
 * holding the place, so every name starts on one edge — its name, and what it mostly works. Chosen, in a picker
 * that adds several at once, it says so with a check; `tag` says anything else short — "In this
 * day", "Pinned".
 */
export function ExerciseRow({
  name,
  muscles,
  thumbnail,
  tag,
  chosen = false,
  onPress,
  testID,
}: {
  readonly name: string
  readonly muscles: string
  /** Absolute: a path the API answered resolved first (`apiUrl`). */
  readonly thumbnail: string | null
  readonly tag?: string | undefined
  readonly chosen?: boolean
  readonly onPress: () => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      aria-selected={chosen}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      {thumbnail === null ? (
        <View style={styles.slot}>
          <Text variant="label" tone="faint">
            {name.charAt(0).toUpperCase()}
          </Text>
        </View>
      ) : (
        <Thumbnail uri={thumbnail} label={`${name}, video`} size="row" />
      )}
      <Stack grow gap="xs">
        <Text variant="label" numberOfLines={1} testID={`${testID}-name`}>
          {name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {tag === undefined ? muscles : `${tag} · ${muscles}`}
        </Text>
      </Stack>
      {chosen ? <Icon name="check" /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  pressed: { backgroundColor: color.surface },
  slot: {
    width: ROW_THUMB_WIDTH,
    aspectRatio: 16 / 9,
    borderRadius: radius.sm,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
