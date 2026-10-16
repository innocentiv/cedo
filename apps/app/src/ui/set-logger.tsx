import { useState } from 'react'
import {
  type Effort,
  type SetTarget,
  type TrackingMode,
  fieldsOf,
  formatEffort,
} from '@cedo/contract'
import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { DimensionInput } from './dimension-input.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/** What one logged set measured, in base units. */
export type LoggedValues = Effort

export interface SetLoggerProps {
  readonly exerciseName: string
  readonly tracking: TrackingMode
  /** What the plan prescribes for this set, if it came from one. */
  readonly target: SetTarget | null
  /** What the progression rule suggests for NEXT time, when it differs from the target. */
  readonly suggestion: string | null
  readonly done: number
  readonly onLog: (values: LoggedValues) => void
  readonly busy: boolean
  readonly testID: string
}

/**
 * One exercise, mid-workout: what was prescribed, what has been done, and the next set's inputs.
 *
 * Which inputs appear is decided by the exercise's `tracking` mode, which the contract defines —
 * the screen does not guess from whether a weight happens to be null. See docs/08-frontend.md.
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
            {`Prescribed ${formatEffort(target, tracking)}`}
          </Text>
        )}

        {suggestion === null ? null : (
          <Text variant="caption" tone="accent" testID={`${testID}-suggestion`}>
            {suggestion}
          </Text>
        )}

        {/* Which fields, in which order, labelled how: the contract's, as in the plan editor. */}
        <Stack direction="row" gap="sm">
          {fieldsOf(tracking).map((field) => (
            <DimensionInput
              key={field.dimension}
              dimension={field.dimension}
              tracking={tracking}
              value={effort[field.key]}
              onChange={(value) => {
                setEffort((current) => ({ ...current, [field.key]: value }))
              }}
              testID={`${testID}-${field.dimension}`}
            />
          ))}
        </Stack>

        <Button
          title="Log set"
          onPress={() => {
            onLog(effort)
          }}
          busy={busy}
          testID={`${testID}-log`}
        />
      </Stack>
    </Card>
  )
}
