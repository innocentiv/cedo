import { useState } from 'react'
import {
  type Effort,
  type MarkedSet,
  type SetTarget,
  type TrackingMode,
  fieldsOf,
} from '@cedo/contract'
import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { IconButton } from './icon.tsx'
import { SetMarks } from './set-marks.tsx'
import { Stack } from './stack.tsx'
import { Stepper } from './stepper.tsx'
import { Text } from './text.tsx'

export interface NextSet {
  readonly target: SetTarget
  readonly isWarmup: boolean
  /** What it is, as the athlete reads it: "Warm-up 1 of 2", "Set 3 of 5", "Another set". */
  readonly title: string
  /** The button's words: "Log warm-up", "Log set 3", "Log another set". */
  readonly action: string
}

export interface FocusLoggerProps {
  readonly name: string
  readonly cue: string | null
  readonly tracking: TrackingMode
  readonly sets: readonly MarkedSet[]
  readonly selected: string | null
  readonly onSelect: (key: string) => void
  readonly next: NextSet
  /** When progression moved this session's target off the plan's, what the plan says. */
  readonly progressed: string | null
  /** Last time's working sets, as read. */
  readonly last: string | null
  readonly busy: boolean
  readonly onLog: (effort: Effort, isWarmup: boolean) => void
  /** How to do it — absent where there is nothing more to show than its name. */
  readonly onHowTo?: (() => void) | undefined
  readonly testID: string
}

/**
 * The exercise the session is on (#24): its sets as marks, the next one's numbers — as large as the
 * screen allows, with − / + — and one button to log it, under the thumb. The numbers start from what
 * the next set asks, and start again when the next set changes: the screen keys it by that set.
 * Which inputs appear is the contract's `fieldsOf`; reserve is asked after, not here.
 */
export function FocusLogger({
  name,
  cue,
  tracking,
  sets,
  selected,
  onSelect,
  next,
  progressed,
  last,
  busy,
  onLog,
  onHowTo,
  testID,
}: FocusLoggerProps): React.JSX.Element {
  // In base units throughout: the fields convert for display, so nothing here does arithmetic.
  const [effort, setEffort] = useState<Effort>({
    weightG: next.target.weightG,
    reps: next.target.reps,
    durationS: next.target.durationS,
    distanceMm: next.target.distanceMm,
  })
  return (
    <Stack gap="lg" testID={testID}>
      <Stack gap="sm">
        <Stack direction="row" align="center" gap="sm">
          <Stack grow>
            <Text variant="title" testID={`${testID}-name`}>
              {name}
            </Text>
          </Stack>
          {onHowTo === undefined ? null : (
            <IconButton
              name="info"
              label="How to do it"
              edge="end"
              onPress={onHowTo}
              testID={`${testID}-how-to`}
            />
          )}
        </Stack>
        {cue === null ? null : (
          <Text tone="muted" testID={`${testID}-cue`}>
            {cue}
          </Text>
        )}
      </Stack>
      <SetMarks sets={sets} selected={selected} onSelect={onSelect} testID={`${testID}-sets`} />

      <Card>
        <Stack gap="lg">
          <Stack gap="xs">
            <Text
              variant="label"
              tone={next.isWarmup ? 'warmup' : 'accent'}
              testID={`${testID}-next`}
            >
              {next.title}
            </Text>
            {progressed === null ? null : (
              <Text variant="caption" tone="muted" testID={`${testID}-target`}>
                {progressed}
              </Text>
            )}
          </Stack>
          <Stack gap="md">
            {fieldsOf(tracking).map((field) => (
              <Stack key={field.dimension} grow>
                <Stepper
                  dimension={field.dimension}
                  tracking={tracking}
                  value={effort[field.key]}
                  onChange={(value) => {
                    setEffort((current) => ({ ...current, [field.key]: value }))
                  }}
                  testID={`${testID}-${field.dimension}`}
                />
              </Stack>
            ))}
          </Stack>
          <Stack gap="sm">
            <Button
              title={next.action}
              size="large"
              busy={busy}
              onPress={() => {
                onLog(effort, next.isWarmup)
              }}
              testID={`${testID}-log`}
            />
            {last === null ? null : (
              <Text variant="caption" tone="faint" align="center" testID={`${testID}-last`}>
                {last}
              </Text>
            )}
          </Stack>
        </Stack>
      </Card>
    </Stack>
  )
}
