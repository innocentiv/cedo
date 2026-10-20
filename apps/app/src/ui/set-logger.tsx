import { useState } from 'react'
import {
  type Effort,
  type SetTarget,
  type TrackingMode,
  fieldsOf,
  formatEffort,
} from '@cedo/contract'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { DimensionInput } from './dimension-input.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

export interface SetLoggerProps {
  readonly exerciseName: string
  /** Null for an unavailable exercise: nothing more can be logged against it. */
  readonly tracking: TrackingMode | null
  /** What the plan prescribes for this set, if it came from one. */
  readonly target: SetTarget | null
  /** What the progression rule suggests for NEXT time, when it differs from the target. */
  readonly suggestion: string | null
  readonly done: number
  readonly onLog: (values: Effort) => void
  readonly busy: boolean
  readonly testID: string
}

/**
 * One exercise, mid-workout: what was prescribed, what has been done, and the next set's inputs.
 *
 * Which inputs appear is decided by the exercise's `tracking` mode, which the contract defines —
 * the screen does not guess from whether a weight happens to be null. See docs/08-frontend.md.
 *
 * An unavailable exercise has no mode to decide them, and the server refuses a set logged against
 * it: it shows what was prescribed and done, as measured, and no inputs at all. It used to get
 * weight-and-reps fields and a Log button that could only fail. See GLOSSARY.md.
 */
export function SetLogger({
  exerciseName,
  tracking,
  target,
  suggestion,
  done,
  onLog,
  busy,
  testID,
}: SetLoggerProps): React.JSX.Element {
  const unit = useWeightUnit()
  // In base units throughout: the fields convert for display, so nothing here does arithmetic.
  const [effort, setEffort] = useState<Effort>({
    weightG: target?.weightG ?? null,
    reps: target?.reps ?? null,
    durationS: target?.durationS ?? null,
    distanceMm: target?.distanceMm ?? null,
  })

  return (
    <Card testID={testID}>
      <Stack gap="sm">
        <Stack direction="row" gap="sm" align="center">
          <Stack grow>
            <Text variant="label">{exerciseName}</Text>
          </Stack>
          <Text variant="mono" tone="muted" testID={`${testID}-done`}>
            {`${done} done`}
          </Text>
        </Stack>

        {target === null ? null : (
          <Text variant="caption" tone="muted" testID={`${testID}-target`}>
            {`Prescribed ${formatEffort(target, tracking, unit)}`}
          </Text>
        )}

        {suggestion === null ? null : (
          <Text variant="caption" tone="accent" testID={`${testID}-suggestion`}>
            {suggestion}
          </Text>
        )}

        {tracking === null ? (
          <Text variant="caption" tone="muted" testID={`${testID}-unavailable`}>
            Out of your reach: nothing more can be logged against it.
          </Text>
        ) : (
          <Inputs
            tracking={tracking}
            effort={effort}
            onChange={setEffort}
            busy={busy}
            onLog={() => {
              onLog(effort)
            }}
            testID={testID}
          />
        )}
      </Stack>
    </Card>
  )
}

/** The next set's fields — which, in which order, labelled how: the contract's — and Log. */
function Inputs({
  tracking,
  effort,
  onChange,
  busy,
  onLog,
  testID,
}: {
  readonly tracking: TrackingMode
  readonly effort: Effort
  readonly onChange: (update: (current: Effort) => Effort) => void
  readonly busy: boolean
  readonly onLog: () => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <>
      <Stack direction="row" gap="sm">
        {fieldsOf(tracking).map((field) => (
          <DimensionInput
            key={field.dimension}
            dimension={field.dimension}
            tracking={tracking}
            value={effort[field.key]}
            onChange={(value) => {
              onChange((current) => ({ ...current, [field.key]: value }))
            }}
            testID={`${testID}-${field.dimension}`}
          />
        ))}
      </Stack>

      <Button title="Log set" onPress={onLog} busy={busy} testID={`${testID}-log`} />
    </>
  )
}
