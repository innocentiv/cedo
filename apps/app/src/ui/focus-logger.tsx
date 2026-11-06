import { useState } from 'react'
import {
  type Effort,
  type Load,
  type LogSetInput,
  type MarkedSet,
  type NextSet,
  type TrackingMode,
  type Undone,
  asksReserveOf,
  fieldsOf,
  formatReserve,
  startingEffort,
} from '@cedo/contract'
import { Card } from './card.tsx'
import { FocusHeading } from './focus-heading.tsx'
import { type JustDone, LogSlot } from './rest-control.tsx'
import { ReserveSegments } from './reserve-segments.tsx'
import { SetMarks } from './set-marks.tsx'
import { Stack } from './stack.tsx'
import { Stepper } from './stepper.tsx'
import { Text } from './text.tsx'

/** A set as the logger hands it over: its numbers, whether a warm-up, and its reserve. */
export interface LoggedHere {
  readonly effort: Effort
  readonly isWarmup: boolean
  readonly reserve: LogSetInput['reserve']
}

export interface FocusLoggerProps {
  readonly name: string
  readonly cue: string | null
  readonly tracking: TrackingMode
  readonly sets: readonly MarkedSet[]
  readonly next: NextSet
  /**
   * The set just undone, of this entry: the numbers start from what it said, not the target (#63).
   */
  readonly from: Undone | null
  /** The set just logged, while it can be taken back: shown in Log's place (#63). */
  readonly after: JustDone | null
  /** When progression moved this session's target off the plan's, what the plan says. */
  readonly progressed: string | null
  /** Last time's working sets, as read. */
  readonly last: string | null
  readonly busy: boolean
  /** The weights the athlete can load on it, when known: − / + move between them (#36). */
  readonly load: Load | null
  /** The set's numbers, whether a warm-up, and how hard it was — reserve, said before (#37). */
  readonly onLog: (set: LoggedHere) => void
  /** How to do it — absent where there is nothing more to show than its name. */
  readonly onHowTo?: (() => void) | undefined
  readonly testID: string
}

/**
 * The exercise the session is on (#24): its sets as marks, the next one's numbers — as large as the
 * screen allows, with − / + — and one button to log it, under the thumb. The numbers start from
 * what the next set asks — or what a set just undone said — and start again when the next set
 * changes: the screen keys it by that set. Once a set is logged, its rest takes Log's place, with
 * Undo (#63). Which inputs appear is the contract's `fieldsOf`; reserve is asked here too, before
 * the set is logged (#37), of the sets the contract's `asksReserveOf` names.
 */
export function FocusLogger({
  name,
  cue,
  tracking,
  sets,
  next,
  from,
  after,
  progressed,
  last,
  busy,
  load,
  onLog,
  onHowTo,
  testID,
}: FocusLoggerProps): React.JSX.Element {
  // In base units throughout: the fields convert for display, so nothing here does arithmetic.
  // A bodyweight movement asked for no weight starts at none added, 0 (`startingEffort`).
  const [effort, setEffort] = useState<Effort>(
    from?.effort ?? startingEffort(next.target, tracking),
  )
  // Asked before the set is logged, of a working set counted in reps (the contract's
  // `asksReserveOf`), and never pre-filled — not even from the plan's reserve: the answer is the
  // athlete's (#37). Empty for each set because the screen keys this logger by the set it logs —
  // but for a set just undone, whose answer was given.
  const [reserve, setReserve] = useState<number | null>(from?.reserve ?? null)
  const asked = asksReserveOf(next, tracking)
  return (
    <Stack gap="lg" testID={testID}>
      <FocusHeading name={name} cue={cue} onHowTo={onHowTo} testID={testID} />
      <SetMarks sets={sets} testID={`${testID}-sets`} />

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
            {/* Each as tall as it is: `grow` in a column shared the height out equally, and a
                weight whose unit wraps — "kg assistance" — ran over the reserve under it. */}
            {fieldsOf(tracking).map((field) => (
              <Stepper
                key={field.dimension}
                dimension={field.dimension}
                tracking={tracking}
                load={load}
                value={effort[field.key]}
                onChange={(value) => {
                  setEffort((current) => ({ ...current, [field.key]: value }))
                }}
                testID={`${testID}-${field.dimension}`}
              />
            ))}
          </Stack>
          {asked ? (
            <ReserveAsked
              asks={next.target.reserve}
              reserve={reserve}
              onChange={setReserve}
              testID={testID}
            />
          ) : null}
          <Stack gap="sm">
            <LogSlot
              after={after}
              action={next.action}
              busy={busy}
              onLog={() => {
                onLog({ effort, isWarmup: next.isWarmup, reserve: asked ? reserve : null })
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

/**
 * How hard the set was, asked before it is logged (#37): what this set asks said above it — each
 * working set may ask its own (ADR-0026) — and the answer never pre-filled: it is how the set went.
 */
function ReserveAsked({
  asks,
  reserve,
  onChange,
  testID,
}: {
  readonly asks: number | null
  readonly reserve: number | null
  readonly onChange: (reserve: number | null) => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack gap="xs">
      {asks === null ? null : (
        <Text variant="caption" tone="muted" testID={`${testID}-asks`}>
          {`Leave ${formatReserve(asks)} in reserve`}
        </Text>
      )}
      <ReserveSegments
        label="Reps in reserve"
        reserve={reserve}
        onChange={onChange}
        testID={`${testID}-reserve`}
      />
    </Stack>
  )
}
