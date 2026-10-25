import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { REST_EXTENSION_S, type Rest, formatDuration, restRemaining } from '@cedo/contract'
import { chime } from '../lib/chime.ts'
import { useUntilNextSet } from '../lib/until-next-set.ts'
import { useNow } from '../lib/use-now.ts'
import { Button } from './button.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { color, radius, space } from './tokens.ts'

/**
 * The rest after a set, across the top of the workout (#24): blue while it runs — the rest plate —
 * with +30 s and Skip; yellow once it is over, the next set's colour, with one tone when it is seen
 * to run out — never on opening a screen whose rest is already over. It stays until the next set is
 * logged or it is skipped. Which rest runs, and how much is left, are the contract's (`restOf`,
 * `restRemaining`); this counts the +30 s taps and the clock.
 */
export function RestBand({
  rest,
  testID,
}: {
  readonly rest: Rest | null
  readonly testID: string
}): React.JSX.Element | null {
  const since = rest?.since ?? null
  const [extended, extend] = useUntilNextSet<number>(since)
  const [skipped, skip] = useUntilNextSet<true>(since)
  const extensions = extended ?? 0

  const [ticking, setTicking] = useState(true)
  const now = useNow(ticking)
  const left = rest === null ? null : restRemaining(rest, extensions, now)
  const running = left !== null && left > 0
  if (running !== ticking) setTicking(running)

  // The tone is for a rest seen running and then over: opened over, it is silent.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running && skipped === null) chime()
    wasRunning.current = running
  }, [running, skipped])

  if (left === null || skipped !== null) return null
  return (
    <View style={[styles.band, running ? styles.resting : styles.ready]} testID={testID}>
      <Stack direction="row" align="center" gap="md">
        <Stack grow>
          <Text variant="caption" tone={running ? 'default' : 'onAccent'}>
            {running ? 'Rest' : 'Rest over'}
          </Text>
          <Text variant="number" tone={running ? 'default' : 'onAccent'} testID={`${testID}-left`}>
            {running ? formatDuration(left) : 'Next set'}
          </Text>
        </Stack>
        {running ? (
          <Button
            title={`+${REST_EXTENSION_S} s`}
            variant="secondary"
            onPress={() => {
              extend(extensions + 1)
            }}
            testID={`${testID}-more`}
          />
        ) : null}
        <Button
          title={running ? 'Skip' : 'Dismiss'}
          variant="secondary"
          onPress={() => {
            skip(true)
          }}
          testID={`${testID}-skip`}
        />
      </Stack>
    </View>
  )
}

const styles = StyleSheet.create({
  band: { borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  resting: { backgroundColor: color.rest },
  ready: { backgroundColor: color.accent },
})
