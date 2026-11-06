import {
  type Chosen,
  type Exercise,
  type SessionDay,
  type SessionExercise,
  formatPrescription,
  nextSet,
  progressOf,
} from '@cedo/contract'
import { AddRow, Stack, UpNext } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { type RestShown, useJustDone } from './just-done.ts'
import { AddedExercises } from './workout-adhoc.tsx'
import { InFocus } from './workout-focus.tsx'
import type { WorkoutSets, WorkoutShown } from './workout-state.ts'
import { useWeightUnit } from './weight-unit.ts'

/*
 * A session that follows a plan's day (#24): the entry in focus, with what was just done in its
 * Log's place (`PlannedMain`, #63), then the rest of the day, what was added to it, and every set
 * (`PlannedSide`) — the screen's two columns, side by side on a desktop. What shows is the
 * contract's `workoutView`; this renders it, and says what the athlete taps. See
 * docs/08-frontend.md.
 */

/** What the main column of a planned day reads. */
export interface PlannedMainProps {
  readonly sets: WorkoutSets
  readonly rest: RestShown
  /** The exercises added this open, whole: how to do them can be shown. */
  readonly full: readonly Exercise[]
  readonly view: WorkoutShown
  readonly onChoose: (chosen: Chosen) => void
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly onFinish: () => Promise<void>
  readonly finishing: boolean
}

/** The entry in focus — its next set under the thumb, and what was just done in Log's place. */
export function PlannedMain({
  sets,
  rest,
  full,
  view,
  onChoose,
  onHowTo,
  onFinish,
  finishing,
}: PlannedMainProps): React.JSX.Element {
  const unit = useWeightUnit()
  const { shown, another } = view
  const after = useJustDone({
    rest,
    shown,
    sets,
    onAnother:
      another === null
        ? undefined
        : () => {
            onChoose({ entry: another })
          },
  })
  return (
    <InFocus
      focus={view.focus}
      sets={sets}
      full={full}
      after={after}
      onHowTo={onHowTo}
      onFinish={onFinish}
      finishing={finishing}
      unit={unit}
    />
  )
}

/** What the side column of a planned day reads. */
export interface PlannedSideProps {
  readonly day: SessionDay
  readonly sets: WorkoutSets
  /** Exercises logged with no entry — swaps — then any added since: `exercisesInSession`. */
  readonly added: readonly SessionExercise[]
  readonly view: WorkoutShown
  readonly onChoose: (chosen: Chosen) => void
  /** Every set the session holds, under the day. */
  readonly record: React.ReactNode
  readonly onAdd: () => void
}

/** The rest of the day, what was added to it, and every set the session holds. */
export function PlannedSide({
  day,
  sets,
  added,
  view,
  onChoose,
  record,
  onAdd,
}: PlannedSideProps): React.JSX.Element {
  const unit = useWeightUnit()
  const { current, setsFor } = view
  const add = <AddRow title="Add exercise" onPress={onAdd} testID="session-add-exercise" />

  return (
    <>
      <Stack gap="xs">
        <UpNext
          items={day.entries.map((entry) => ({
            id: String(entry.index),
            name: exerciseName(entry.exercise),
            detail: formatPrescription(entry.sets, entry.exercise?.tracking ?? null, unit),
            progress: progressOf(setsFor(entry)),
            done: nextSet(setsFor(entry)) === null,
            superset: entry.supersetGroup,
          }))}
          current={current.upNext === null ? null : String(current.upNext.index)}
          onChoose={(index) => {
            const entry = day.entries.find((e) => String(e.index) === index)
            if (entry !== undefined) onChoose({ entry: entry.id })
          }}
          testID="up-next"
        />
        {added.length === 0 ? add : null}
      </Stack>
      {added.length === 0 ? null : (
        <Stack gap="xs">
          <AddedExercises
            title="Added today"
            exercises={added}
            sets={sets}
            current={current.addedToday}
            onChoose={(id) => {
              onChoose({ added: id })
            }}
          />
          {add}
        </Stack>
      )}
      {record}
    </>
  )
}
