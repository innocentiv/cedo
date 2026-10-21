import {
  type Prescription,
  type TrackingMode,
  type WorkoutSetInput,
  fieldsOf,
} from '@cedo/contract'
import { DimensionInput } from './dimension-input.tsx'
import { ReserveChips } from './reserve-chips.tsx'
import { Stack } from './stack.tsx'

/**
 * What an entry's working sets are prescribed: only the quantities this exercise measures, in the
 * contract's order and terms, and the reps to leave in reserve. Each change is a patch the contract
 * applies to every working set (`prescribe`).
 */
export function PrescriptionFields({
  first,
  tracking,
  onChange,
  testID,
}: {
  /** The first working set, which every working set shares. */
  readonly first: WorkoutSetInput | undefined
  readonly tracking: TrackingMode
  readonly onChange: (patch: Prescription) => void
  readonly testID: string
}): React.JSX.Element {
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
              onChange({ [field.targetKey]: value })
            }}
            testID={`${testID}-${field.dimension}`}
          />
        ))}
      </Stack>
      <ReserveChips
        label="Reps to leave in reserve"
        rpe={first?.targetRpe ?? null}
        onChange={(targetRpe) => {
          onChange({ targetRpe })
        }}
        testID={`${testID}-reserve`}
      />
    </Stack>
  )
}
