import { Pressable, StyleSheet, View } from 'react-native'
import { REST_EXTENSION_S, formatDuration } from '@cedo/contract'
import { Button } from './button.tsx'
import { FormError } from './feedback.tsx'
import { IconButton } from './icon.tsx'
import { LastSet, type LastSetProps } from './last-set.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { LOG_CONTROL_HEIGHT, color, radius, space } from './tokens.ts'

/**
 * The set just logged, while it can still be taken back where it was logged (#63): while its rest
 * runs, or — no rest after it — until the next set. What the screen hands the logger to show in
 * Log's place.
 */
export interface JustDone {
  /** The rest running, or null: none follows the set, and Log stays, beside Undo. */
  readonly rest: {
    readonly left: number
    /** +30 s: a tap on the countdown. */
    readonly onExtend: () => void
    readonly onSkip: () => void
    /** Offered while nothing tells this phone a rest's end with the app closed (#39). */
    readonly onTell: (() => void) | null
  } | null
  /** Null while the set waits for a signal: there is nothing on the server to take back yet. */
  readonly onUndo: (() => void) | null
  readonly set: Omit<LastSetProps, 'testID'>
  /** A +30 s or a skip refused — or notifications, by iOS. */
  readonly error: string | null
}

/**
 * Where Log was, once a set is logged (#63) — a time control for what is linear in time: Undo, the
 * rest counting down, and Skip. Tapping the countdown adds 30 s. With no rest running, Undo sits
 * beside `log`, the logger's own button; where nothing more is logged — the day done — beside
 * nothing. The set just logged is said under it, where Undo's effect is seen. Once the rest is over
 * none of it is shown: the chime says so, and Log is back. The rest's plate is blue, as the band's
 * was.
 */
export function AfterSet({
  after,
  log,
}: {
  readonly after: JustDone
  readonly log: React.ReactNode
}): React.JSX.Element {
  const { rest, onUndo } = after
  return (
    <Stack gap="sm">
      <View style={styles.row} testID="rest-control">
        {onUndo === null ? null : (
          <IconButton
            name="undo"
            label="Undo the set just logged"
            raised
            onPress={onUndo}
            testID="rest-control-undo"
          />
        )}
        {rest === null ? (
          <View style={styles.grow}>{log}</View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Rest, ${formatDuration(rest.left)} left. Add ${String(REST_EXTENSION_S)} seconds`}
            onPress={rest.onExtend}
            testID="rest-control-more"
            style={({ pressed }) => [styles.clock, pressed ? styles.pressed : null]}
          >
            <Text variant="label">Rest</Text>
            <Text variant="number" testID="rest-control-left">
              {formatDuration(rest.left)}
            </Text>
            <Text variant="caption" tone="muted">
              {`+${String(REST_EXTENSION_S)} s`}
            </Text>
          </Pressable>
        )}
        {rest === null ? null : (
          <IconButton
            name="skip"
            label="Skip the rest"
            raised
            onPress={rest.onSkip}
            testID="rest-control-skip"
          />
        )}
      </View>
      {rest?.onTell == null ? null : (
        <Button
          title="Tell me when rest is over"
          variant="ghost"
          onPress={rest.onTell}
          testID="rest-control-tell"
        />
      )}
      <FormError message={after.error} testID="rest-error" />
      <LastSet {...after.set} testID="last-set" />
    </Stack>
  )
}

/** Log, under the thumb — or, once a set is logged, what was just done in its place (#63). */
export function LogSlot({
  after,
  action,
  busy,
  onLog,
  testID,
}: {
  readonly after: JustDone | null
  /** The button's words: "Log set 3". */
  readonly action: string
  readonly busy: boolean
  readonly onLog: () => void
  readonly testID: string
}): React.JSX.Element {
  const log = <Button title={action} size="large" busy={busy} onPress={onLog} testID={testID} />
  return after === null ? log : <AfterSet after={after} log={log} />
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  clock: {
    flex: 1,
    minHeight: LOG_CONTROL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.rest,
  },
  pressed: { opacity: 0.75 },
})
