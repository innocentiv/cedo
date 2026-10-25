import { useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { Icon } from './icon.tsx'
import { NavButton } from './nav-button.tsx'
import { Stack } from './stack.tsx'
import { Thumbnail } from './thumbnail.tsx'
import { CONTROL_HEIGHT, color, radius } from './tokens.ts'

/**
 * An exercise's video, played where it is shown (#27): its thumbnail with a play mark, and — tapped
 * — the provider's own player in its place. Nothing is fetched from the provider until then: a
 * self-hosted instance asks nothing of a third party a person did not ask for. Off the web, or for a
 * link no player can show, Watch the video opens it instead.
 */
export function VideoPlayer({
  embedUrl,
  thumbnail,
  url,
  label,
  testID,
}: {
  readonly embedUrl: string | null
  /** Absolute: a path the API answered resolved first (`apiUrl`). */
  readonly thumbnail: string | null
  readonly url: string
  readonly label: string
  readonly testID: string
}): React.JSX.Element {
  const [playing, setPlaying] = useState(false)
  const playable = embedUrl !== null && Platform.OS === 'web'
  if (playing && embedUrl !== null) {
    return (
      <View style={styles.frame} testID={`${testID}-player`}>
        <iframe
          src={`${embedUrl}${embedUrl.includes('?') ? '&' : '?'}autoplay=1`}
          title={label}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          style={FRAME_STYLE}
        />
      </View>
    )
  }
  return (
    <Stack gap="sm" testID={testID}>
      {thumbnail === null ? null : playable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Play ${label}`}
          onPress={() => {
            setPlaying(true)
          }}
          testID={`${testID}-play`}
        >
          <Thumbnail uri={thumbnail} label={label} />
          <View style={styles.mark}>
            <View style={styles.disc}>
              <Icon name="play" tone="onAccent" />
            </View>
          </View>
        </Pressable>
      ) : (
        <Thumbnail uri={thumbnail} label={label} />
      )}
      {playable && thumbnail !== null ? null : (
        <NavButton title="Watch the video" href={url} testID={`${testID}-link`} />
      )}
    </Stack>
  )
}

/** A DOM element's style, not React Native's: the player is the browser's own frame. */
const FRAME_STYLE = { width: '100%', height: '100%', border: 0 } as const

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surfaceRaised,
  },
  mark: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: CONTROL_HEIGHT,
    height: CONTROL_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
