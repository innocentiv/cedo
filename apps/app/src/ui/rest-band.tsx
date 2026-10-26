import { StyleSheet, View } from 'react-native'
import { REST_EXTENSION_S, type Rest, formatDuration } from '@cedo/contract'
import { useRestClock } from '../lib/rest-clock.ts'
import { Button } from './button.tsx'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { color, radius, space } from './tokens.ts'

/**
 * The rest after a set, above the set it follows (#24): blue while it runs — the rest plate — with
 * +30 s, and × to skip it; yellow once it is over, the next set's colour. It stays until the next
 * set is logged or it is skipped. The clock is `useRestClock`'s.
 */
export function RestBand({
  rest,
  testID,
}: {
  readonly rest: Rest | null
  readonly testID: string
}): React.JSX.Element | null {
  const { left, running, extend, skip } = useRestClock(rest)
  if (left === null) return null
  const tone = running ? 'default' : 'onAccent'
  return (
    <View style={[styles.band, running ? styles.resting : styles.ready]} testID={testID}>
      <Stack direction="row" align="center" gap="md">
        <Stack direction="row" align="baseline" gap="sm" grow>
          <Text variant="label" tone={tone}>
            {running ? 'Rest' : 'Rest over'}
          </Text>
          <Text variant="number" tone={tone} testID={`${testID}-left`}>
            {running ? formatDuration(left) : 'Next set'}
          </Text>
        </Stack>
        {running ? (
          <Button
            title={`+${REST_EXTENSION_S} s`}
            variant="secondary"
            size="small"
            onPress={extend}
            testID={`${testID}-more`}
          />
        ) : null}
        <IconButton
          name="close"
          label={running ? 'Skip the rest' : 'Dismiss'}
          edge="end"
          tone={tone}
          onPress={skip}
          testID={`${testID}-skip`}
        />
      </Stack>
    </View>
  )
}

const styles = StyleSheet.create({
  // Room round the +30 s and × it holds: at xs, the button sat on the band's edges (#37).
  band: { borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  resting: { backgroundColor: color.rest },
  ready: { backgroundColor: color.accent },
})
