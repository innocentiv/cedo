import {
  type Exercise,
  type Reopened,
  type SessionDay,
  type SessionExercise,
  type WorkoutChoices,
  formatPrescription,
  nextSet,
  progressOf,
} from '@cedo/contract'
import { AddRow, Columns, Stack, UpNext } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { JustDone, type RestShown, ShownSet } from './shown-set.tsx'
import { AddedExercises } from './workout-adhoc.tsx'
import { InFocus } from './workout-focus.tsx'
import type { WorkoutSets, WorkoutShown } from './workout-state.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * A session that follows a plan's day (#24): what was just done and the entry in focus, then the
 * rest of the day, what was added to it, and every set — side by side on a desktop. What shows is
 * the contract's `workoutView`; this renders it, and says what the athlete taps. See
 * docs/08-frontend.md.
 */
export function PlannedDay({
  day,
  sets,
  rest,
  added,
  full,
  view,
  onChoose,
  onReopen,
  record,
  onAdd,
  onHowTo,
  onFinish,
  finishing,
}: {
  readonly day: SessionDay
  readonly sets: WorkoutSets
  readonly rest: RestShown
  /** Exercises logged with no entry — swaps — then any added since: `exercisesInSession`. */
  readonly added: readonly SessionExercise[]
  /** The exercises added this open, whole: how to do them can be shown. */
  readonly full: readonly Exercise[]
  readonly view: WorkoutShown
  readonly onChoose: (chosen: WorkoutChoices['chosen']) => void
  readonly onReopen: (reopened: Reopened) => void
  /** Every set the session holds, under the day. */
  readonly record: React.ReactNode
  readonly onAdd: () => void
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly onFinish: () => Promise<void>
  readonly finishing: boolean
}): React.JSX.Element {
  const unit = useWeightUnit()
  const { shown, another, current, setsFor } = view
  const add = <AddRow title="Add exercise" onPress={onAdd} testID="session-add-exercise" />

  return (
    <Columns
      main={
        <>
          <JustDone rest={rest}>
            {shown === null ? null : (
              <ShownSet
                log={shown.log}
                exercise={shown.exercise}
                sets={sets}
                onAnother={
                  another === null
                    ? undefined
                    : () => {
                        onChoose({ entry: another })
                      }
                }
              />
            )}
          </JustDone>
          <InFocus
            focus={view.focus}
            sets={sets}
            full={full}
            onReopen={onReopen}
            onHowTo={onHowTo}
            onFinish={onFinish}
            finishing={finishing}
            unit={unit}
          />
        </>
      }
      side={
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
      }
    />
  )
}
