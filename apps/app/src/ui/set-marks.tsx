import { Pressable, StyleSheet, View } from 'react-native'
import type { MarkedSet } from '@cedo/contract'
import { color, radius, space } from './tokens.ts'
import { Text } from './text.tsx'

/**
 * An entry's sets at a glance, in order: warm-ups smaller and in chalk outline, the next ringed in
 * yellow, a done set filled, a personal best filled green, one waiting for a signal dashed. A done
 * set is a button — tapping it re-opens it, to undo it or say its reserve.
 */
export function SetMarks({
  sets,
  selected,
  onSelect,
  testID,
}: {
  readonly sets: readonly MarkedSet[]
  readonly selected: string | null
  readonly onSelect: (key: string) => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <View style={styles.row} testID={testID}>
      {sets.map((set) => {
        const logged = set.mark === 'done' || set.mark === 'best' || set.mark === 'waiting'
        return (
          <Pressable
            key={set.key}
            disabled={!logged}
            accessibilityRole="button"
            accessibilityLabel={`${set.isWarmup ? 'Warm-up' : 'Set'} ${set.label}, ${set.mark}`}
            aria-selected={selected === set.key}
            onPress={() => {
              onSelect(set.key)
            }}
            testID={`${testID}-${set.key}`}
            style={[
              styles.mark,
              set.isWarmup ? styles.warmup : null,
              MARK[set.mark],
              selected === set.key ? styles.selected : null,
            ]}
          >
            <Text variant="caption" tone={TONE[set.mark]}>
              {set.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const TONE = {
  todo: 'faint',
  next: 'accent',
  done: 'onAccent',
  best: 'onAccent',
  waiting: 'muted',
} as const

const SIZE = 40

const MARK = StyleSheet.create({
  todo: { borderColor: color.border },
  next: { borderColor: color.accent, borderWidth: 2 },
  done: { borderColor: color.text, backgroundColor: color.text },
  best: { borderColor: color.success, backgroundColor: color.success },
  waiting: { borderColor: color.textMuted, borderStyle: 'dashed' },
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  mark: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warmup: { width: SIZE - space.sm, height: SIZE - space.sm, alignSelf: 'center' },
  selected: { borderColor: color.accent, borderWidth: 2 },
})
