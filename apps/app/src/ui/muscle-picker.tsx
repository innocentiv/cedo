import { MUSCLES, type MuscleLoad, type MuscleSlug, withMuscleToggled } from '@cedo/contract'
import { Pressable, StyleSheet } from 'react-native'
import { color, radius, space } from './tokens.ts'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { NumberInput } from './input.tsx'

export interface MusclePickerProps {
  readonly value: readonly MuscleLoad[]
  readonly onChange: (value: MuscleLoad[]) => void
}

/**
 * Which muscles a movement loads, and by how much: chosen, they start as an even split (#27), and
 * keep to one until someone sets them.
 *
 * The screen does NOT decide whether the loads are valid — `ExerciseCreate` in the contract refuses
 * anything that does not sum to 100, and the API, the MCP tools and this form all fail the same way
 * with the same message. The running total shown here is a hint, not a rule.
 * See docs/08-frontend.md.
 */
export function MusclePicker({ value, onChange }: MusclePickerProps): React.JSX.Element {
  const chosen = new Map(value.map((m) => [m.muscle, m.loadPct]))
  const total = value.reduce((sum, m) => sum + m.loadPct, 0)

  // An even split while the loads are untouched; once someone set them, theirs (#27).
  const toggle = (slug: MuscleSlug) => {
    onChange(withMuscleToggled(value, slug))
  }

  const setLoad = (slug: MuscleSlug, loadPct: number | null) => {
    onChange(
      value.map((m) => (m.muscle === slug ? { muscle: m.muscle, loadPct: loadPct ?? 0 } : m)),
    )
  }

  return (
    <Stack gap="sm" testID="muscle-picker">
      <Text variant="caption" tone={total === 100 ? 'default' : 'muted'} testID="muscle-total">
        {`Load total ${total}% of 100%`}
      </Text>

      <Stack gap="xs">
        {value.map((m) => (
          <Stack key={m.muscle} direction="row" gap="sm" align="center">
            {/* Width lives on a Stack, not the Text: `Text` takes no style by design. */}
            <Stack gap="xs" style={styles.name}>
              <Text variant="caption">
                {MUSCLES.find((x) => x.slug === m.muscle)?.name ?? m.muscle}
              </Text>
            </Stack>
            <NumberInput
              value={m.loadPct === 0 ? null : m.loadPct}
              onChange={(next) => {
                setLoad(m.muscle, next)
              }}
              placeholder="%"
              testID={`muscle-load-${m.muscle}`}
            />
          </Stack>
        ))}
      </Stack>

      <MuscleOptions chosen={chosen} onToggle={toggle} />
    </Stack>
  )
}

/**
 * Wrapped, not a horizontal scroller. There are 34 muscles, and a one-line scroller puts most of
 * them behind a sideways gesture nobody discovers.
 */
function MuscleOptions({
  chosen,
  onToggle,
}: {
  readonly chosen: ReadonlyMap<string, number>
  readonly onToggle: (slug: MuscleSlug) => void
}): React.JSX.Element {
  return (
    <Stack direction="row" gap="xs" wrap testID="muscle-options">
      {MUSCLES.map((muscle) => (
        <Pressable
          key={muscle.slug}
          accessibilityRole="button"
          testID={`muscle-option-${muscle.slug}`}
          onPress={() => {
            onToggle(muscle.slug)
          }}
          style={[styles.chip, chosen.has(muscle.slug) ? styles.selected : null]}
        >
          <Text variant="caption" tone={chosen.has(muscle.slug) ? 'default' : 'muted'}>
            {muscle.name}
          </Text>
        </Pressable>
      ))}
    </Stack>
  )
}

const styles = StyleSheet.create({
  name: { width: 120 },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  selected: { borderColor: color.text, backgroundColor: color.surfaceRaised },
})
