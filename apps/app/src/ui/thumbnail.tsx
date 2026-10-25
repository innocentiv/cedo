import { Image, StyleSheet } from 'react-native'
import { color, radius } from './tokens.ts'

/**
 * A picture of a movement — a video's thumbnail, an uploaded image — at the width it is given, in
 * the 16:9 a video is. `uri` already absolute: an upload's path is resolved by `apiUrl` first.
 */
export function Thumbnail({
  uri,
  label,
  testID,
}: {
  readonly uri: string
  /** What it shows, for a screen reader. */
  readonly label: string
  readonly testID?: string | undefined
}): React.JSX.Element {
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={label}
      resizeMode="cover"
      style={styles.image}
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
})
