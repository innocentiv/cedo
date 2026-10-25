import { Pressable, StyleSheet, View } from 'react-native'
import type { MarkedSet, SetMark } from '@cedo/contract'
import { MARK_SIZE, color, radius, space, stroke } from './tokens.ts'
import { Text } from './text.tsx'

/**
 * An entry's sets at a glance, in order (#24). The colours are the plates', one meaning each: the
 * next ringed yellow — act now; a personal best green; a warm-up white, a step smaller. A working set
 * done is grey; one waiting for a signal, dashed. A done set is a button — tapping it re-opens it,
 * to undo it or say its reserve — and the set re-opened is ringed in chalk, never yellow, so it is
 * not taken for the next.
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
        const look = set.isWarmup && set.mark === 'done' ? 'warmupDone' : set.mark
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
              LOOK[look],
              selected === set.key ? styles.selected : null,
            ]}
          >
            <Text variant="caption" tone={TONE[look]}>
              {set.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

type Look = SetMark | 'warmupDone'

const TONE: Readonly<Record<Look, 'faint' | 'accent' | 'default' | 'onAccent' | 'muted'>> = {
  todo: 'faint',
  next: 'accent',
  done: 'default',
  warmupDone: 'onAccent',
  best: 'onAccent',
  waiting: 'muted',
}

const LOOK = StyleSheet.create({
  todo: { borderColor: color.border },
  next: { borderColor: color.accent, borderWidth: stroke.bold },
  done: { borderColor: color.surfaceRaised, backgroundColor: color.surfaceRaised },
  warmupDone: { borderColor: color.warmup, backgroundColor: color.warmup },
  best: { borderColor: color.best, backgroundColor: color.best },
  waiting: { borderColor: color.textMuted, borderStyle: 'dashed' },
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    borderRadius: radius.pill,
    borderWidth: stroke.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warmup: { width: MARK_SIZE - space.sm, height: MARK_SIZE - space.sm, alignSelf: 'center' },
  selected: { borderColor: color.text, borderWidth: stroke.bold },
})
