import { type SetKind, type TrackingMode, resizeSets, setCounts } from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { Chips } from './chips.tsx'
import { PrescriptionFields } from './prescription-fields.tsx'
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

export interface EntryEditorProps {
  readonly entry: EntryDraft
  /** Decides which target inputs exist. A plank has no kilograms. */
  readonly tracking: TrackingMode
  readonly onChange: (entry: EntryDraft) => void
  readonly testID: string
}

/**
 * Everything one entry of a plan asks (#26): its sets, their targets, reserve, rest and cue, its
 * superset and its progression. Only the fields: the sheet or panel it opens in says which exercise
 * it is, and holds what is done to the entry as a whole — moving it, removing it.
 */
export function EntryEditor({
  entry,
  tracking,
  onChange,
  testID,
}: EntryEditorProps): React.JSX.Element {
  // The rules are the contract's: how bands resize within the entry's total, and what a target
  // change applies to. See `plan-editing.ts`.
  const counts = setCounts(entry)

  return (
    <Stack gap="lg" testID={testID}>
      <Counts
        warmups={counts.warmup}
        working={counts.working}
        onResize={(band, count) => {
          onChange(resizeSets(entry, band, count))
        }}
        testID={testID}
      />

      <PrescriptionFields entry={entry} tracking={tracking} onChange={onChange} testID={testID} />

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
  readonly onResize: (band: SetKind, count: number | null) => void
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
