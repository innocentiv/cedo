import { Image, StyleSheet } from 'react-native'
import { ROW_THUMB_WIDTH, color, radius } from './tokens.ts'

/**
 * A picture of a movement — a video's thumbnail, an uploaded image — at the width it is given, in
 * the 16:9 a video is. `uri` already absolute: an upload's path is resolved by `apiUrl` first.
 */
export function Thumbnail({
  uri,
  label,
  size = 'full',
  testID,
}: {
  readonly uri: string
  /** What it shows, for a screen reader. */
  readonly label: string
  /** `row`: small, at the start of a list's row (#27); the width it is given otherwise. */
  readonly size?: 'full' | 'row'
  readonly testID?: string | undefined
}): React.JSX.Element {
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={label}
      resizeMode="cover"
      style={[styles.image, size === 'row' ? styles.row : null]}
      testID={testID}
    />
  )
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
  },
  row: { width: ROW_THUMB_WIDTH, borderRadius: radius.sm },
})
