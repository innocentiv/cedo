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
import { AdHocFocus } from './workout-adhoc.tsx'
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

/** The entry in focus: its sets, the next one large, and Log — as the contract's `loggerAsks`. */
function Focus({
  focus,
  sets,
  after,
  onHowTo,
  unit,
}: {
  readonly focus: Extract<WorkoutShown['focus'], { kind: 'entry' }>
  readonly sets: WorkoutSets
  readonly after: JustDone | null
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly unit: WeightUnit
}): React.JSX.Element {
  const { entry } = focus
  const { exercise } = entry
  const asks = loggerAsks(focus, sets.waiting, unit, sets.all.length)
  const load = useLoads()(exercise)
  return (
    <FocusLogger
      // The numbers start again from what the next set asks when the key changes.
      key={asks.key}
      name={exercise.name}
      cue={entry.cue}
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
      onHowTo={() => {
        onHowTo(exercise, entry.cue)
      }}
      testID={`log-entry-${entry.index}`}
    />
  )
}

/**
 * What is in focus: an unavailable entry, an added exercise, the entry, or — all done — Finish.
 * Where nothing is logged — the day done, an entry out of reach — the set just logged is said above
 * it.
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
  if (focus.kind === 'added') {
    return (
      <AdHocFocus
        focus={focus}
        whole={full.find((e) => e.id === focus.exercise.id)}
        sets={sets}
        after={after}
        onHowTo={(whole) => {
          onHowTo(whole, null)
        }}
      />
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
  return <Focus focus={focus} sets={sets} after={after} onHowTo={onHowTo} unit={unit} />
}
