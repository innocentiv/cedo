import {
  type Exercise,
  NO_TARGET,
  type Reopened,
  type SessionExercise,
  type SessionSet,
  type WorkoutChoices,
  adHocSetsOf,
  markedSets,
  nextSet,
  nextSetWords,
  progressOf,
} from '@cedo/contract'
import type { PendingLog } from '../api/pending.ts'
import { AddRow, Columns, FocusLogger, Stack, UpNext } from '../ui/index.ts'
import { JustDone, type RestShown, ShownSet } from './shown-set.tsx'
import { useLoads } from './use-loads.ts'
import type { WorkoutSets, WorkoutShown } from './workout-state.ts'

/**
 * A session with no plan behind it (#24): what was just done and the exercise in focus, then the
 * others, Add exercise, and every set — side by side on a desktop. Nothing was prescribed, so there
 * is always a next set until the athlete moves on. What shows is the contract's `workoutView`.
 */
export function AdHocDay({
  exercises,
  full,
  sets,
  rest,
  view,
  onChoose,
  onReopen,
  record,
  onAdd,
  onHowTo,
}: {
  /** What the session has logged, then anything picked since — `exercisesInSession`. */
  readonly exercises: readonly SessionExercise[]
  /** The exercises picked this open, whole: how to do them can be shown. */
  readonly full: readonly Exercise[]
  readonly sets: WorkoutSets
  readonly rest: RestShown
  readonly view: WorkoutShown
  readonly onChoose: (chosen: WorkoutChoices['chosen']) => void
  readonly onReopen: (reopened: Reopened) => void
  /** Every set the session holds, under its exercises. */
  readonly record: React.ReactNode
  readonly onAdd: () => void
  readonly onHowTo: (exercise: Exercise) => void
}): React.JSX.Element {
  const { focus, shown, current } = view

  return (
    <Columns
      testID="session-adhoc"
      main={
        <>
          <JustDone rest={rest}>
            {shown === null ? null : (
              <ShownSet log={shown.log} exercise={shown.exercise} sets={sets} />
            )}
          </JustDone>
          {focus.kind === 'added' ? (
            <AdHocFocus
              exercise={focus.exercise}
              marks={focus.sets}
              whole={full.find((e) => e.id === focus.exercise.id)}
              sets={sets}
              selected={focus.selected}
              onSelect={(key) => {
                onReopen({ entryId: null, exerciseId: focus.exercise.id, key })
              }}
              onHowTo={onHowTo}
            />
          ) : null}
        </>
      }
      side={
        <>
          <Stack gap="xs">
            <AddedExercises
              exercises={exercises}
              sets={sets}
              current={current.addedToday}
              onChoose={(id) => {
                onChoose({ added: id })
              }}
            />
            <AddRow title="Add exercise" onPress={onAdd} testID="adhoc-add-exercise" />
          </Stack>
          {record}
        </>
      }
    />
  )
}

/**
 * The exercises logged with no plan entry, one line each — the whole day of a session without a
 * plan, or the swaps in one that has.
 */
export function AddedExercises({
  exercises,
  sets,
  current,
  onChoose,
  title,
}: {
  readonly exercises: readonly SessionExercise[]
  readonly sets: WorkoutSets
  readonly current: string | null
  readonly onChoose: (id: string) => void
  readonly title?: string | undefined
}): React.JSX.Element | null {
  return (
    <UpNext
      title={title}
      items={exercises.map((exercise) => {
        const progress = progressOf(adHocSetsOf(exercise.id, sets.all), false)
        return {
          id: exercise.id,
          name: exercise.name,
          detail: '',
          progress,
          done: false,
          superset: null,
        }
      })}
      current={current}
      onChoose={onChoose}
      testID="adhoc-row"
    />
  )
}

/** An exercise logged with no plan entry, in focus: its sets, and one more from the last. */
export function AdHocFocus({
  exercise,
  marks,
  whole,
  sets,
  selected,
  onSelect,
  onHowTo,
}: {
  readonly exercise: SessionExercise
  /** Its sets, as the contract's `workoutView` gives them: those logged, then one more. */
  readonly marks: readonly SessionSet<PendingLog>[]
  /** The whole exercise, when it was picked this open: how to do it can be shown. */
  readonly whole: Exercise | undefined
  readonly sets: WorkoutSets
  readonly selected: string | null
  readonly onSelect: (key: string) => void
  readonly onHowTo: (exercise: Exercise) => void
}): React.JSX.Element {
  // Its weights as the athlete can load them, when the whole exercise is at hand (#36).
  const load = useLoads()(whole)
  const next = nextSet(marks)
  const words = nextSetWords(marks, next, false)
  return (
    <FocusLogger
      // By how many sets there are, not the last one's id, which changes when a set sent late lands.
      key={`${exercise.id}:${String(sets.all.length)}`}
      name={exercise.name}
      cue={null}
      tracking={exercise.tracking}
      sets={markedSets(marks, sets.waiting)}
      selected={selected}
      onSelect={onSelect}
      next={{
        target: next?.target ?? NO_TARGET,
        isWarmup: false,
        title: words.title,
        action: words.action,
      }}
      progressed={null}
      last={null}
      busy={sets.record.busy}
      load={load}
      onLog={(set) => {
        sets.record.log({ exerciseId: exercise.id, entryId: null, ...set })
      }}
      onHowTo={
        whole === undefined
          ? undefined
          : () => {
              onHowTo(whole)
            }
      }
      testID={`adhoc-${exercise.id}`}
    />
  )
}
