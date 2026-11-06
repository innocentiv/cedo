import {
  type Chosen,
  type Exercise,
  type SessionExercise,
  adHocSetsOf,
  loggerAsks,
  progressOf,
} from '@cedo/contract'
import { AddRow, FocusLogger, type JustDone, Stack, UpNext } from '../ui/index.ts'
import { type RestShown, useJustDone } from './just-done.ts'
import { useLoads } from './use-loads.ts'
import { useWeightUnit } from './weight-unit.ts'
import type { WorkoutSets, WorkoutShown } from './workout-state.ts'

/*
 * A session with no plan behind it (#24): the exercise in focus, with what was just done in its
 * Log's place (`AdHocMain`, #63), then the others, Add exercise, and every set (`AdHocSide`) — the
 * screen's two columns, side by side on a desktop. Nothing was prescribed, so there is always a
 * next set until the athlete moves on. What shows is the contract's `workoutView`.
 */

/** What the main column of a session with no plan reads. */
export interface AdHocMainProps {
  /** The exercises picked this open, whole: how to do them can be shown. */
  readonly full: readonly Exercise[]
  readonly sets: WorkoutSets
  readonly rest: RestShown
  readonly view: WorkoutShown
  readonly onHowTo: (exercise: Exercise) => void
}

/** The exercise in focus — one more set from the last — and what was just done in Log's place. */
export function AdHocMain({
  full,
  sets,
  rest,
  view,
  onHowTo,
}: AdHocMainProps): React.JSX.Element | null {
  const { focus, shown } = view
  const after = useJustDone({ rest, shown, sets })
  if (focus.kind !== 'added') return null
  return (
    <AdHocFocus
      focus={focus}
      whole={full.find((e) => e.id === focus.exercise.id)}
      sets={sets}
      after={after}
      onHowTo={onHowTo}
    />
  )
}

/** What the side column of a session with no plan reads. */
export interface AdHocSideProps {
  /** What the session has logged, then anything picked since — `exercisesInSession`. */
  readonly exercises: readonly SessionExercise[]
  readonly sets: WorkoutSets
  readonly view: WorkoutShown
  readonly onChoose: (chosen: Chosen) => void
  /** Every set the session holds, under its exercises. */
  readonly record: React.ReactNode
  readonly onAdd: () => void
}

/** The session's exercises, Add exercise, and every set it holds. */
export function AdHocSide({
  exercises,
  sets,
  view,
  onChoose,
  record,
  onAdd,
}: AdHocSideProps): React.JSX.Element {
  return (
    <>
      <Stack gap="xs">
        <AddedExercises
          exercises={exercises}
          sets={sets}
          current={view.current.addedToday}
          onChoose={(id) => {
            onChoose({ added: id })
          }}
        />
        <AddRow title="Add exercise" onPress={onAdd} testID="adhoc-add-exercise" />
      </Stack>
      {record}
    </>
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
  focus,
  whole,
  sets,
  after,
  onHowTo,
}: {
  /** As the contract's `workoutView` gives it: its sets, those logged then one more. */
  readonly focus: Extract<WorkoutShown['focus'], { kind: 'added' }>
  /** The whole exercise, when it was picked this open: how to do it can be shown. */
  readonly whole: Exercise | undefined
  readonly sets: WorkoutSets
  /** The set just logged, while it can be taken back: in Log's place (#63). */
  readonly after: JustDone | null
  readonly onHowTo: (exercise: Exercise) => void
}): React.JSX.Element {
  const { exercise } = focus
  // Its weights as the athlete can load them, when the whole exercise is at hand (#36).
  const load = useLoads()(whole)
  const asks = loggerAsks(focus, sets.waiting, useWeightUnit(), sets.all.length)
  return (
    <FocusLogger
      // The numbers start again from what the next set asks when the key changes.
      key={asks.key}
      name={exercise.name}
      cue={null}
      tracking={exercise.tracking}
      sets={asks.marks}
      from={asks.from}
      after={after}
      next={asks.next}
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
              onHowTo(whole)
            }
      }
      testID={`adhoc-${exercise.id}`}
    />
  )
}
