import {
  type SetTarget,
  type TrackingMode,
  fieldsOf,
  formatEffort,
  hasTarget,
  prescribeAt,
  setNames,
  warmupsAt,
  workingAt,
  type prescribe,
} from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { DimensionInput } from './dimension-input.tsx'
import { Help, Label } from './entry-section.tsx'
import { ReserveSegments } from './reserve-segments.tsx'
import { Stack } from './stack.tsx'

/**
 * An entry's sets written one by one (docs/08-frontend.md, "An entry's settings"): warm-ups, each
 * its own line under either mode, and on Manual each working set its own line — reps, weight, reps
 * in reserve — so a top set and its back-offs are written as on paper.
 */

interface LinesProps {
  readonly entry: EntryDraft
  readonly tracking: TrackingMode
  readonly onChange: (entry: EntryDraft) => void
  readonly target: { readonly warmups: readonly SetTarget[] } | null
  readonly testID: string
}

/** The fields of one set, in its exercise's terms, each patching only what it holds. */
function SetFields({
  set,
  tracking,
  onPatch,
  testID,
}: {
  readonly set: EntryDraft['sets'][number]
  readonly tracking: TrackingMode
  readonly onPatch: (patch: Parameters<typeof prescribe>[1]) => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack direction="row" gap="sm" wrap>
      {fieldsOf(tracking).map((field) => (
        <DimensionInput
          key={field.dimension}
          dimension={field.dimension}
          tracking={tracking}
          value={set[field.targetKey]}
          onChange={(value) => {
            onPatch({ [field.targetKey]: value })
          }}
          testID={`${testID}-${field.dimension}`}
        />
      ))}
    </Stack>
  )
}

/** Each warm-up its own line; under a rule, what the next session asks of it beside. */
export function Warmups({
  entry,
  tracking,
  onChange,
  target,
  testID,
}: LinesProps): React.JSX.Element {
  const unit = useWeightUnit()
  const ruled = hasTarget(entry.progression)
  const names = setNames(entry.sets)
  return (
    <>
      {warmupsAt(entry).map(({ set, at }, i) => {
        const n = i + 1
        const next = target?.warmups[i]
        return (
          <Stack key={at} gap="xs">
            <Label>{names[at] ?? ''}</Label>
            <SetFields
              set={set}
              tracking={tracking}
              onPatch={(patch) => {
                onChange(prescribeAt(entry, at, patch))
              }}
              testID={`${testID}-warmup-${String(n)}`}
            />
            {ruled && next !== undefined ? (
              <Help testID={`${testID}-warmup-${String(n)}-next`}>
                {`Your next session: ${formatEffort(next, tracking, unit)}`}
              </Help>
            ) : null}
          </Stack>
        )
      })}
    </>
  )
}

/** On Manual, a line per working set — reps, weight, reps in reserve — so back-offs are written. */
export function ManualLines({ entry, tracking, onChange, testID }: LinesProps): React.JSX.Element {
  const lines = workingAt(entry)
  const names = setNames(entry.sets)
  return (
    <Stack gap="md">
      {lines.map(({ set, at }, n) => (
        <Stack key={at} gap="xs" testID={`${testID}-set-${String(n + 1)}`}>
          <Label>{names[at] ?? ''}</Label>
          <SetFields
            set={set}
            tracking={tracking}
            onPatch={(patch) => {
              onChange(prescribeAt(entry, at, patch))
            }}
            testID={`${testID}-set-${String(n + 1)}`}
          />
          <ReserveSegments
            reserve={set.targetReserve}
            onChange={(targetReserve) => {
              onChange(prescribeAt(entry, at, { targetReserve }))
            }}
            testID={`${testID}-set-${String(n + 1)}-reserve`}
          />
        </Stack>
      ))}
    </Stack>
  )
}
