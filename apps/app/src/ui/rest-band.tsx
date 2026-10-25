import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { type FlowLog, formatDuration, restLeft } from '@cedo/contract'
import { chime } from '../lib/chime.ts'
import { useNow } from '../lib/use-now.ts'
import { Button } from './button.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { color, radius, space } from './tokens.ts'

/**
 * The rest after a set, across the top of the workout (#24): blue while it runs — the rest plate's
 * colour — with +30 s and Skip; yellow once it is over, the next set's colour, with one tone if the
 * app is open. It stays until the next set is logged or it is skipped. How long is left is the
 * contract's `restLeft`, counted from when the server logged the set — a reload counts the same.
 */
export function RestBand({
  logs,
  entry,
  testID,
}: {
  readonly logs: readonly FlowLog[]
  /** The entry whose rest runs — `restingAfter` — or null when none does. */
  readonly entry: { readonly id: string; readonly restSeconds: number | null } | null
  readonly testID: string
}): React.JSX.Element | null {
  // Both belong to the set logged last: logging the next starts a new rest, with nothing added.
  const latest = logs.at(-1)?.id ?? null
  const [added, setAdded] = useState({ for: latest, seconds: 0 })
  const [skipped, setSkipped] = useState<string | null>(null)
  const extra = added.for === latest ? added.seconds : 0
  const rest = entry === null || entry.restSeconds === null ? null : entry.restSeconds + extra

  const [ticking, setTicking] = useState(true)
  const now = useNow(ticking)
  const left =
    entry === null || rest === null ? null : restLeft(logs, { ...entry, restSeconds: rest }, now)
  const running = left !== null && left > 0
  if (running !== ticking) setTicking(running)

  // One tone as it reaches zero, for the set it was counting after — never again on a re-render.
  const [chimed, setChimed] = useState<string | null>(null)
  const over = left === 0 && skipped !== latest
  useEffect(() => {
    if (over && chimed !== latest) {
      setChimed(latest)
      chime()
    }
  }, [over, chimed, latest])

  if (left === null || skipped === latest) return null
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
            title="+30 s"
            variant="secondary"
            onPress={() => {
              setAdded({ for: latest, seconds: extra + 30 })
            }}
            testID={`${testID}-more`}
          />
        ) : null}
        <Button
          title={running ? 'Skip' : 'Dismiss'}
          variant="secondary"
          onPress={() => {
            setSkipped(latest)
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
