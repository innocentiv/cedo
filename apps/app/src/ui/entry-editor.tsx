import { type TrackingMode, fieldsOf } from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { Chips } from './chips.tsx'
import { DimensionInput } from './dimension-input.tsx'
import { ProgressionField } from './progression-field.tsx'
import { CompactField, NumberInput } from './input.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/** `null` is "performed alone". Four letters is more parallel work than anyone runs at once. */
const SUPERSET_OPTIONS = [
  { value: '-', label: 'Alone' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
] as const

type SetDraft = EntryDraft['sets'][number]

const blankSet = (): SetDraft => ({
  targetReps: 8,
  targetWeightG: null,
  targetRpe: null,
  targetDurationS: null,
  targetDistanceMm: null,
  isWarmup: false,
})

export interface EntryEditorProps {
  readonly entry: EntryDraft
  readonly exerciseName: string
  /** Decides which target inputs exist. A plank has no kilograms. */
  readonly tracking: TrackingMode
  readonly onChange: (entry: EntryDraft) => void
  readonly onRemove: () => void
  readonly testID: string
}

export function EntryEditor({
  entry,
  exerciseName,
  tracking,
  onChange,
  onRemove,
  testID,
}: EntryEditorProps): React.JSX.Element {
  const warmups = entry.sets.filter((s) => s.isWarmup)
  const workingSets = entry.sets.filter((s) => !s.isWarmup)
  /**
   * The prescription is the first WORKING set, which is also what `progression/service.ts` reads.
   * Taking `sets[0]` instead showed a warm-up's light load as the prescription.
   */
  const first = workingSets[0]

  /** Rebuilds one band of sets, leaving the other untouched. */
  const resize = (band: 'warmup' | 'working', count: number | null) => {
    const next = Math.max(band === 'warmup' ? 0 : 1, Math.min(count ?? 0, 20))
    const template = { ...(first ?? blankSet()), isWarmup: band === 'warmup' }
    const rebuilt = Array.from({ length: next }, () => ({ ...template }))
    onChange({
      ...entry,
      sets: band === 'warmup' ? [...rebuilt, ...workingSets] : [...warmups, ...rebuilt],
    })
  }

  /** One prescription per entry: working sets never diverge. Warm-ups keep their lighter load. */
  const setAll = (patch: Partial<SetDraft>) => {
    onChange({ ...entry, sets: entry.sets.map((s) => (s.isWarmup ? s : { ...s, ...patch })) })
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

        <Counts
          warmups={warmups.length}
          working={workingSets.length}
          onResize={resize}
          testID={testID}
        />

        <Targets first={first} tracking={tracking} onChange={setAll} testID={testID} />

        <Superset
          value={entry.supersetGroup}
          onChange={(supersetGroup) => {
            onChange({ ...entry, supersetGroup })
          }}
          testID={testID}
        />

        <ProgressionField
          rule={entry.progression}
          onChange={(progression) => {
            onChange({ ...entry, progression })
          }}
          testID={testID}
        />
      </Stack>
    </Card>
  )
}

/** Warm-ups and working sets are counted separately, because they progress differently. */
function Counts({
  warmups,
  working,
  onResize,
  testID,
}: {
  readonly warmups: number
  readonly working: number
  readonly onResize: (band: 'warmup' | 'working', count: number | null) => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack direction="row" gap="sm">
      <CompactField label="warm-ups">
        <NumberInput
          value={warmups}
          onChange={(n) => {
            onResize('warmup', n)
          }}
          testID={`${testID}-warmups`}
        />
      </CompactField>
      <CompactField label="sets">
        <NumberInput
          value={working}
          onChange={(n) => {
            onResize('working', n)
          }}
          testID={`${testID}-sets`}
        />
      </CompactField>
    </Stack>
  )
}

/** Only the quantities this exercise measures, in the contract's order and terms. */
function Targets({
  first,
  tracking,
  onChange,
  testID,
}: {
  readonly first: SetDraft | undefined
  readonly tracking: TrackingMode
  readonly onChange: (patch: Partial<SetDraft>) => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack direction="row" gap="sm">
      {fieldsOf(tracking).map((field) => (
        <DimensionInput
          key={field.dimension}
          dimension={field.dimension}
          tracking={tracking}
          value={first?.[field.targetKey] ?? null}
          onChange={(value) => {
            // Only the target that changed: the patch is applied to every working set. `targetKey`
            // is derived from the set schema this draft comes from, so it names a real field.
            onChange({ [field.targetKey]: value })
          }}
          testID={`${testID}-${field.dimension}`}
        />
      ))}
    </Stack>
  )
}

/**
 * Entries sharing a letter are performed alternating. A tag rather than a nesting level, so
 * reordering stays a plain array move. See docs/03-domain-model.md.
 */
function Superset({
  value,
  onChange,
  testID,
}: {
  readonly value: string | null
  readonly onChange: (value: string | null) => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack gap="xs">
      <Text variant="caption" tone="muted">
        Superset
      </Text>
      <Chips
        options={SUPERSET_OPTIONS}
        value={value ?? '-'}
        onChange={(next) => {
          onChange(next === '-' ? null : next)
        }}
        testID={`${testID}-superset`}
      />
      {value === null ? null : (
        <Text variant="caption" tone="faint">
          {`Alternated with every other entry marked ${value} on this day.`}
        </Text>
      )}
    </Stack>
  )
}
