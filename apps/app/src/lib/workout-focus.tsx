import {
  type EntryTarget,
  type Exercise,
  NO_TARGET,
  type Reopened,
  type SessionEntry,
  type WeightUnit,
  formatEffort,
  formatSets,
  markedSets,
  nextSet,
  nextSetWords,
  prescriptionOf,
  targetLine,
} from '@cedo/contract'
import { ConfirmButton, FocusLogger, Stack, Text } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { useLoads } from './use-loads.ts'
import { AdHocFocus } from './workout-adhoc.tsx'
import type { WorkoutSets, WorkoutShown } from './workout-state.ts'

/**
 * What a planned day has in focus (#24), and how it shows. Which it is — and which of its sets is
 * re-opened — is the contract's `workoutView`; this renders it.
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

/** The entry in focus: its sets, the next one large, and Log. */
function Focus({
  entry,
  exercise,
  sets,
  entrySets,
  asked,
  selected,
  onSelect,
  onHowTo,
  unit,
}: {
  readonly entry: SessionEntry
  readonly exercise: Exercise
  readonly sets: WorkoutSets
  readonly entrySets: Extract<WorkoutShown['focus'], { kind: 'entry' }>['sets']
  readonly asked: EntryTarget | undefined
  readonly selected: string | null
  readonly onSelect: (key: string) => void
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly unit: WeightUnit
}): React.JSX.Element {
  const next = nextSet(entrySets)
  const words = nextSetWords(entrySets, next, true)
  const target = next?.target ?? asked?.target ?? prescriptionOf(entry)?.target ?? NO_TARGET
  const load = useLoads()(exercise)
  const { tracking } = exercise
  return (
    <FocusLogger
      // Keyed by the set it logs: the numbers start again from what the NEXT set asks. By how many
      // sets there are, not the last one's id: a set logged without a signal changes id when the
      // server has it, and a reserve already chosen for the next set would be lost to it (#37).
      key={`${entry.id}:${next?.key ?? 'more'}:${String(sets.all.length)}`}
      name={exercise.name}
      cue={entry.cue}
      tracking={tracking}
      sets={markedSets(entrySets, sets.waiting)}
      selected={selected}
      onSelect={onSelect}
      next={{ target, isWarmup: next?.isWarmup ?? false, title: words.title, action: words.action }}
      progressed={asked === undefined ? null : targetLine(asked, tracking, unit, next ?? undefined)}
      last={asked?.last == null ? null : `Last time ${formatSets(asked.last, tracking, unit)}`}
      busy={sets.record.busy}
      load={load}
      onLog={(set) => {
        sets.record.log({ exerciseId: entry.exerciseId, entryId: entry.id, ...set })
      }}
      onHowTo={() => {
        onHowTo(exercise, entry.cue)
      }}
      testID={`log-entry-${entry.index}`}
    />
  )
}

/** What is in focus: an unavailable entry, an added exercise, the entry, or — all done — Finish. */
export function InFocus({
  focus,
  sets,
  full,
  onReopen,
  onHowTo,
  onFinish,
  finishing,
  unit,
}: {
  readonly focus: WorkoutShown['focus']
  readonly sets: WorkoutSets
  readonly full: readonly Exercise[]
  readonly onReopen: (reopened: Reopened) => void
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly onFinish: () => Promise<void>
  readonly finishing: boolean
  readonly unit: WeightUnit
}): React.JSX.Element | null {
  if (focus.kind === 'unavailable') return <Unavailable entry={focus.entry} unit={unit} />
  if (focus.kind === 'added') {
    const { exercise } = focus
    return (
      <AdHocFocus
        exercise={exercise}
        marks={focus.sets}
        whole={full.find((e) => e.id === exercise.id)}
        sets={sets}
        selected={focus.selected}
        onSelect={(key) => {
          onReopen({ entryId: null, exerciseId: exercise.id, key })
        }}
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
  const { entry } = focus
  return (
    <Focus
      entry={entry}
      exercise={entry.exercise}
      sets={sets}
      entrySets={focus.sets}
      asked={focus.asked}
      selected={focus.selected}
      onSelect={(key) => {
        onReopen({ entryId: entry.id, exerciseId: entry.exerciseId, key })
      }}
      onHowTo={onHowTo}
      unit={unit}
    />
  )
}
