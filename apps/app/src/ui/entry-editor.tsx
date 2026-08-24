import { PROGRESSION_KINDS, type Progression, gToKg, kgToG } from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { Chips } from './chips.tsx'
import { NumberInput } from './input.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

const PROGRESSION_OPTIONS = PROGRESSION_KINDS.map((value) => ({
  value,
  label: { none: 'None', linear: 'Linear', double: 'Double', linear_duration: 'Duration' }[value],
}))

/**
 * Building a progression rule is the one place the editor touches a domain shape, so it does it by
 * constructing the contract's own discriminated union rather than a loose object.
 */
function progressionOf(kind: Progression['kind'], previous: Progression): Progression {
  if (kind === previous.kind) return previous
  switch (kind) {
    case 'none':
      return { kind: 'none' }
    case 'linear':
      return { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }
    case 'double':
      return { kind: 'double', repRange: [8, 12], incrementG: 2500 }
    case 'linear_duration':
      return { kind: 'linear_duration', incrementS: 15, afterSuccesses: 1 }
  }
}

export interface EntryEditorProps {
  readonly entry: EntryDraft
  readonly exerciseName: string
  readonly onChange: (entry: EntryDraft) => void
  readonly onRemove: () => void
  readonly testID: string
}

export function EntryEditor({
  entry,
  exerciseName,
  onChange,
  onRemove,
  testID,
}: EntryEditorProps): React.JSX.Element {
  const warmups = entry.sets.filter((s) => s.isWarmup)
  const workingSets = entry.sets.filter((s) => !s.isWarmup)
  /**
   * The prescription is the first WORKING set, which is also what `progression/service.ts` reads.
   * Taking `sets[0]` instead showed a warm-up's light load as the prescription whenever the plan
   * had one — and plans authored through MCP routinely do.
   */
  const first = workingSets[0]

  /**
   * The field counts WORKING sets, so it must rebuild working sets and leave the warm-ups alone.
   *
   * Rebuilding every set from `sets[0]` turned each of them into a copy of the warm-up — including
   * `isWarmup: true` — which drops the entry below the contract's "at least one working set" and
   * makes the whole plan unsavable with no control on this screen to undo it.
   */
  const setCount = (count: number | null) => {
    const next = Math.max(1, Math.min(count ?? 1, 20))
    const template = first ?? {
      targetReps: 8,
      targetWeightG: null,
      targetRpe: null,
      targetDurationS: null,
      targetDistanceMm: null,
      isWarmup: false,
    }
    onChange({
      ...entry,
      sets: [...warmups, ...Array.from({ length: next }, () => ({ ...template, isWarmup: false }))],
    })
  }

  /** One prescription per entry: working sets never diverge. Warm-ups keep their own lighter load. */
  const setAll = (patch: Partial<(typeof entry.sets)[number]>) => {
    onChange({
      ...entry,
      sets: entry.sets.map((s) => (s.isWarmup ? s : { ...s, ...patch })),
    })
  }

  return (
    <Card testID={testID}>
      <Stack gap="sm">
        <Stack direction="row" gap="sm" align="center">
          <Stack grow>
            <Text variant="label">{exerciseName}</Text>
          </Stack>
          <Button title="Remove" variant="ghost" onPress={onRemove} testID={`${testID}-remove`} />
        </Stack>

        <Stack direction="row" gap="sm" align="center">
          <Stack grow>
            <Text variant="caption" tone="muted">
              Sets
            </Text>
            <NumberInput value={workingSets.length} onChange={setCount} testID={`${testID}-sets`} />
          </Stack>
          <Stack grow>
            <Text variant="caption" tone="muted">
              Reps
            </Text>
            <NumberInput
              value={first?.targetReps ?? null}
              onChange={(reps) => {
                setAll({ targetReps: reps })
              }}
              testID={`${testID}-reps`}
            />
          </Stack>
          <Stack grow>
            <Text variant="caption" tone="muted">
              kg
            </Text>
            <NumberInput
              value={first?.targetWeightG === null ? null : gToKg(first?.targetWeightG ?? 0)}
              onChange={(kg) => {
                setAll({ targetWeightG: kg === null ? null : kgToG(kg) })
              }}
              decimals
              testID={`${testID}-weight`}
            />
          </Stack>
        </Stack>

        <Chips
          options={PROGRESSION_OPTIONS}
          value={entry.progression.kind}
          onChange={(kind) => {
            onChange({ ...entry, progression: progressionOf(kind, entry.progression) })
          }}
          testID={`${testID}-progression`}
        />
      </Stack>
    </Card>
  )
}
