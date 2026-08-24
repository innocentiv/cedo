import { useState } from 'react'
import {
  type SetTarget,
  type TrackingMode,
  formatWeight,
  gToKg,
  kgToG,
  tracks,
} from '@cedo/contract'
import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { NumberInput } from './input.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

export interface LoggedValues {
  readonly weightG: number | null
  readonly reps: number | null
  readonly durationS: number | null
  readonly distanceMm: number | null
}

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
  const [weightKg, setWeightKg] = useState<number | null>(
    target?.weightG === null || target?.weightG === undefined ? null : gToKg(target.weightG),
  )
  const [reps, setReps] = useState<number | null>(target?.reps ?? null)
  const [durationS, setDurationS] = useState<number | null>(target?.durationS ?? null)
  const [distanceM, setDistanceM] = useState<number | null>(
    target?.distanceMm === null || target?.distanceMm === undefined
      ? null
      : target.distanceMm / 1000,
  )

  // From the contract, not restated here: the plan editor asks the same question and the two
  // answers must not drift. See `DIMENSIONS_BY_TRACKING`.
  const showsWeight = tracks(tracking, 'weight')
  const showsReps = tracks(tracking, 'reps')
  const showsDuration = tracks(tracking, 'duration')
  const showsDistance = tracks(tracking, 'distance')

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
            {`Prescribed ${target.reps ?? '—'} × ${
              target.weightG === null ? 'bodyweight' : formatWeight(target.weightG)
            }`}
          </Text>
        )}

        {suggestion === null ? null : (
          <Text variant="caption" tone="accent" testID={`${testID}-suggestion`}>
            {suggestion}
          </Text>
        )}

        <Stack direction="row" gap="sm">
          {showsWeight ? (
            <Stack grow>
              <Text variant="caption" tone="faint">
                kg
              </Text>
              <NumberInput
                value={weightKg}
                onChange={setWeightKg}
                decimals
                testID={`${testID}-weight`}
              />
            </Stack>
          ) : null}
          {showsReps ? (
            <Stack grow>
              <Text variant="caption" tone="faint">
                reps
              </Text>
              <NumberInput value={reps} onChange={setReps} testID={`${testID}-reps`} />
            </Stack>
          ) : null}
          {showsDuration ? (
            <Stack grow>
              <Text variant="caption" tone="faint">
                seconds
              </Text>
              <NumberInput
                value={durationS}
                onChange={setDurationS}
                testID={`${testID}-duration`}
              />
            </Stack>
          ) : null}
          {showsDistance ? (
            <Stack grow>
              <Text variant="caption" tone="faint">
                metres
              </Text>
              <NumberInput
                value={distanceM}
                onChange={setDistanceM}
                decimals
                testID={`${testID}-distance`}
              />
            </Stack>
          ) : null}
        </Stack>

        <Button
          title="Log set"
          onPress={() => {
            onLog({
              weightG: weightKg === null ? null : kgToG(weightKg),
              reps,
              durationS,
              distanceMm: distanceM === null ? null : Math.round(distanceM * 1000),
            })
          }}
          busy={busy}
          testID={`${testID}-log`}
        />
      </Stack>
    </Card>
  )
}
