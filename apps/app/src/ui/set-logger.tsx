import { useState } from 'react'
import {
  type Effort,
  type SetLog,
  type SetTarget,
  type TrackingMode,
  type WorkoutEntry,
  fieldsOf,
  formatEffort,
  formatSets,
  formatWithReserve,
} from '@cedo/contract'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { DimensionInput } from './dimension-input.tsx'
import { ReserveChips } from './reserve-chips.tsx'
import { RestCountdown } from './rest-countdown.tsx'
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
  /** What the plan tells the athlete about this entry, if anything. */
  readonly cue: string | null
  /** The session's sets and this entry, for the rest after its latest working set; null for none. */
  readonly rest: {
    readonly logs: readonly SetLog[]
    readonly entry: Pick<WorkoutEntry, 'id' | 'restSeconds'>
  } | null
  readonly done: number
  /** The set's measures, and how hard it was as an RPE — null when it was not said. */
  readonly onLog: (values: Effort, rpe: number | null) => void
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
  cue,
  rest,
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
  /**
   * The answer belongs to the set being asked about — the one after the `done` so far — and is never
   * pre-filled with the target, which would lead it. Once that set is logged and counted, `done`
   * moves on and the answer is gone with it; a set the server refuses keeps it for the retry.
   */
  const [answer, setAnswer] = useState<{ readonly rpe: number | null; readonly set: number }>({
    rpe: null,
    set: done,
  })
  const rpe = answer.set === done ? answer.rpe : null

  return (
    <Card testID={testID}>
      <Stack gap="sm">
        <Stack direction="row" gap="sm" align="center">
          <Stack grow>
            <Text variant="label">{exerciseName}</Text>
            {cue === null ? null : (
              <Text variant="caption" tone="muted" testID={`${testID}-cue`}>
                {cue}
              </Text>
            )}
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
              ? `Prescribed ${formatWithReserve(target, tracking, unit)}`
              : `Progressed to ${formatWithReserve(target, tracking, unit)} · the plan says ${formatEffort(prescribed, tracking, unit)}`}
          </Text>
        )}

        {last === null ? null : (
          <Text variant="caption" tone="muted" testID={`${testID}-last`}>
            {`Last: ${formatSets(last, tracking, unit)}`}
          </Text>
        )}

        {rest === null ? null : (
          <RestCountdown logs={rest.logs} entry={rest.entry} testID={`${testID}-rest`} />
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
            rpe={rpe}
            onRpe={(next) => {
              setAnswer({ rpe: next, set: done })
            }}
            busy={busy}
            onLog={() => {
              onLog(effort, rpe)
            }}
            testID={testID}
          />
        )}
      </Stack>
    </Card>
  )
}

/**
 * The next set's fields — which, in which order, labelled how: the contract's — how many reps were
 * left in reserve, if the person says, and Log.
 */
function Inputs({
  tracking,
  effort,
  onChange,
  rpe,
  onRpe,
  busy,
  onLog,
  testID,
}: {
  readonly tracking: TrackingMode
  readonly effort: Effort
  readonly onChange: (update: (current: Effort) => Effort) => void
  readonly rpe: number | null
  readonly onRpe: (rpe: number | null) => void
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

      <ReserveChips
        label="Reps in reserve"
        hint="How many more you could have done. Leave it blank if you are not sure."
        rpe={rpe}
        onChange={onRpe}
        testID={`${testID}-reserve`}
      />

      <Button title="Log set" onPress={onLog} busy={busy} testID={`${testID}-log`} />
    </>
  )
}
