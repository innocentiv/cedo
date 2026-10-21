import { type TrackingMode, fieldsOf, prescribe, prescriptionOf } from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { DimensionInput } from './dimension-input.tsx'
import { CompactField, Input } from './input.tsx'
import { ReserveChips } from './reserve-chips.tsx'
import { Stack } from './stack.tsx'

/**
 * What an entry asks of the athlete: the targets this exercise measures, in the contract's order
 * and terms, and the reps to leave in reserve — both on every working set (`prescribe`) — then the
 * rest between sets and a cue, the entry's own. A whole entry in, a whole entry out.
 */
export function PrescriptionFields({
  entry,
  tracking,
  onChange,
  testID,
}: {
  readonly entry: EntryDraft
  readonly tracking: TrackingMode
  readonly onChange: (entry: EntryDraft) => void
  readonly testID: string
}): React.JSX.Element {
  const first = prescriptionOf(entry)
  return (
    <Stack gap="sm">
      <Stack direction="row" gap="sm">
        {fieldsOf(tracking).map((field) => (
          <DimensionInput
            key={field.dimension}
            dimension={field.dimension}
            tracking={tracking}
            value={first?.[field.targetKey] ?? null}
            onChange={(value) => {
              // Only the target that changed: the patch is applied to every working set.
              // `targetKey` is derived from the set schema this draft comes from, so it names a
              // real field.
              onChange(prescribe(entry, { [field.targetKey]: value }))
            }}
            testID={`${testID}-${field.dimension}`}
          />
        ))}
      </Stack>
      <ReserveChips
        label="Reps to leave in reserve"
        rpe={first?.targetRpe ?? null}
        onChange={(targetRpe) => {
          onChange(prescribe(entry, { targetRpe }))
        }}
        testID={`${testID}-reserve`}
      />
      <Stack direction="row" gap="sm">
        <DimensionInput
          dimension="duration"
          label="rest"
          value={entry.restSeconds}
          onChange={(restSeconds) => {
            onChange({ ...entry, restSeconds })
          }}
          testID={`${testID}-rest`}
        />
      </Stack>
      <CompactField label="cue for the athlete">
        <Input
          value={entry.cue ?? ''}
          onChangeText={(cue) => {
            onChange({ ...entry, cue })
          }}
          placeholder="Pause 1 s at the chest"
          testID={`${testID}-cue`}
        />
      </CompactField>
    </Stack>
  )
}
