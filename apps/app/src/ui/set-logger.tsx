import { useState } from 'react'
import {
  type Effort,
  type SetTarget,
  type TrackingMode,
  fieldsOf,
  formatEffort,
  formatSets,
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
  /**
   * What this session asks for, when it follows a plan: the prescription carried forward by its
   * rule over earlier sessions — what the inputs start from. See `EntryTarget`.
   */
  readonly target: SetTarget | null
  /** What the plan itself prescribes, when progression has moved the target away from it. */
  readonly prescribed: SetTarget | null
  /** Last time's working sets of this exercise, if it was done before. */
  readonly last: readonly Effort[] | null
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
  prescribed,
  last,
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
          <Text
            variant="caption"
            tone={prescribed === null ? 'muted' : 'accent'}
            testID={`${testID}-target`}
          >
            {prescribed === null
              ? `Prescribed ${formatEffort(target, tracking, unit)}`
              : `Progressed to ${formatEffort(target, tracking, unit)} · the plan says ${formatEffort(prescribed, tracking, unit)}`}
          </Text>
        )}

        {last === null ? null : (
          <Text variant="caption" tone="muted" testID={`${testID}-last`}>
            {`Last: ${formatSets(last, tracking, unit)}`}
          </Text>
        )}

        {tracking === null ? (
          <Text variant="caption" tone="muted" testID={`${testID}-unavailable`}>
            Nothing more can be logged against it.
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
