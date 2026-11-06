import {
  type Exercise,
  type SessionEntry,
  type WeightUnit,
  formatEffort,
  loggerAsks,
  prescriptionOf,
} from '@cedo/contract'
import { AfterSet, ConfirmButton, FocusLogger, type JustDone, Stack, Text } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { useLoads } from './use-loads.ts'
import type { WorkoutSets, WorkoutShown } from './workout-state.ts'

/**
 * What a planned day has in focus (#24), and how it shows — the set just logged in Log's place
 * (#63). Which it is is the contract's `workoutView`; this renders it.
 */

/** An entry whose exercise the reader can no longer see: what it asked, and nothing to log. */
function Unavailable({
  entry,
  unit,
}: {
  readonly entry: SessionEntry
  readonly unit: WeightUnit
}): React.JSX.Element {
  const asked = prescriptionOf(entry)?.target
  return (
    <Stack gap="sm" testID={`log-entry-${entry.index}`}>
      <Text variant="title">{exerciseName(null)}</Text>
      <Text tone="muted" testID={`log-entry-${entry.index}-target`}>
        {`Prescribed ${asked === undefined ? 'nothing' : formatEffort(asked, null, unit)}`}
      </Text>
      <Text variant="caption" tone="muted" testID={`log-entry-${entry.index}-unavailable`}>
        Nothing more can be logged against it.
      </Text>
    </Stack>
  )
}

/** A focus with something to log: an entry of the day, or an exercise added. */
type Logging = Extract<WorkoutShown['focus'], { kind: 'entry' | 'added' }>

/**
 * What the logger shows of what it logs to: an entry's exercise and cue; an exercise added has no
 * cue, and is at hand whole — how to do it, what loads it — only when picked this open.
 */
const shownOf = (focus: Logging, full: readonly Exercise[]) =>
  focus.kind === 'entry'
    ? {
        exercise: focus.entry.exercise,
        whole: focus.entry.exercise,
        cue: focus.entry.cue,
        testID: `log-entry-${focus.entry.index}`,
      }
    : {
        exercise: focus.exercise,
        whole: full.find((e) => e.id === focus.exercise.id),
        cue: null,
        testID: `adhoc-${focus.exercise.id}`,
      }

/**
 * The entry or exercise in focus: its sets, the next one large, and Log — as the contract's
 * `loggerAsks` decides them.
 */
export function Focus({
  focus,
  full,
  sets,
  after,
  onHowTo,
  unit,
}: {
  readonly focus: Logging
  /** The exercises picked this open, whole. */
  readonly full: readonly Exercise[]
  readonly sets: WorkoutSets
  /** The set just logged, while it can be taken back: in Log's place (#63). */
  readonly after: JustDone | null
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly unit: WeightUnit
}): React.JSX.Element {
  const asks = loggerAsks(focus, sets.waiting, unit, sets.all.length)
  const { exercise, whole, cue, testID } = shownOf(focus, full)
  // Its weights as the athlete can load them, when the whole exercise is at hand (#36).
  const load = useLoads()(whole)
  return (
    <FocusLogger
      // The numbers start again from what the next set asks when the key changes.
      key={asks.key}
      name={exercise.name}
      cue={cue}
      tracking={exercise.tracking}
      sets={asks.marks}
      next={asks.next}
      from={asks.from}
      after={after}
      progressed={asks.progressed}
      last={asks.last}
      busy={sets.busy}
      load={load}
      onLog={(set) => {
        sets.record.log({ ...asks.logsAgainst, ...set })
      }}
      onHowTo={
        whole === undefined
          ? undefined
          : () => {
              onHowTo(whole, cue)
            }
      }
      testID={testID}
    />
  )
}

/**
 * What is in focus: an unavailable entry, all done — Finish — or what is logged: an entry, or an
 * exercise added. Where nothing is logged — the day done, an entry out of reach — the set just
 * logged is said above it.
 */
export function InFocus({
  focus,
  sets,
  full,
  after,
  onHowTo,
  onFinish,
  finishing,
  unit,
}: {
  readonly focus: WorkoutShown['focus']
  readonly sets: WorkoutSets
  readonly full: readonly Exercise[]
  readonly after: JustDone | null
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly onFinish: () => Promise<void>
  readonly finishing: boolean
  readonly unit: WeightUnit
}): React.JSX.Element | null {
  const justDone = after === null ? null : <AfterSet after={after} log={null} />
  if (focus.kind === 'unavailable') {
    return (
      <>
        {justDone}
        <Unavailable entry={focus.entry} unit={unit} />
      </>
    )
  }
  if (focus.kind === 'done') {
    return (
      <Stack gap="md" testID="day-done">
        <Text variant="heading">Every set of the day is logged.</Text>
        {justDone}
        <ConfirmButton
          title="Finish session"
          busy={finishing}
          onConfirm={onFinish}
          testID="finish-session"
        />
      </Stack>
    )
  }
  // A day always has a focus or is done; nothing is in focus only without a plan.
  if (focus.kind === 'none') return null
  return <Focus focus={focus} full={full} sets={sets} after={after} onHowTo={onHowTo} unit={unit} />
}
