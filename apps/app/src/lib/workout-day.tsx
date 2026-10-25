import {
  type EntryTarget,
  type Exercise,
  type SessionDay,
  type SessionExercise,
  formatPrescription,
  nextSet,
  progressOf,
} from '@cedo/contract'
import { Button, Stack, UpNext } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { ShownSet } from './shown-set.tsx'
import { AddedExercises } from './workout-adhoc.tsx'
import { InFocus, usePlannedFocus } from './workout-focus.tsx'
import type { WorkoutSets } from './workout-state.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * A session that follows a plan's day (#24): the set shown, the entry in focus, the rest of the day,
 * and what was added to it. Every rule is the contract's `session-flow`; this holds only what the
 * athlete chose to look at, until the next set is logged. See docs/08-frontend.md.
 */
export function PlannedDay({
  day,
  targets,
  sets,
  extras,
  full,
  added,
  onAdd,
  onHowTo,
  onFinish,
  finishing,
}: {
  readonly day: SessionDay
  readonly targets: readonly EntryTarget[]
  readonly sets: WorkoutSets
  /** Exercises logged with no entry — swaps — then any added since: `exercisesInSession`. */
  readonly extras: readonly SessionExercise[]
  /** The exercises added this open, whole: how to do them can be shown. */
  readonly full: readonly Exercise[]
  readonly added: string | null
  readonly onAdd: () => void
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly onFinish: () => Promise<void>
  readonly finishing: boolean
}): React.JSX.Element {
  const unit = useWeightUnit()
  const focused = usePlannedFocus(day, targets, sets, extras, added)
  const { choose, setsFor, extraInFocus, focus, shown, shownEntry, another } = focused

  return (
    <Stack gap="xl">
      <ShownSet
        log={shown}
        exercise={shownEntry?.exercise ?? extras.find((e) => e.id === shown?.exerciseId) ?? null}
        sets={sets}
        onAnother={
          another === null
            ? undefined
            : () => {
                choose({ entry: another })
              }
        }
      />
      <InFocus
        focused={focused}
        sets={sets}
        full={full}
        onHowTo={onHowTo}
        onFinish={onFinish}
        finishing={finishing}
        unit={unit}
      />
      <UpNext
        items={day.entries.map((entry) => ({
          id: String(entry.index),
          name: exerciseName(entry.exercise),
          detail: formatPrescription(entry.sets, entry.exercise?.tracking ?? null, unit),
          progress: progressOf(setsFor(entry)),
          done: nextSet(setsFor(entry)) === null,
          superset: entry.supersetGroup,
        }))}
        current={extraInFocus !== undefined || focus === null ? null : String(focus.index)}
        onChoose={(index) => {
          const entry = day.entries.find((e) => String(e.index) === index)
          if (entry !== undefined) choose({ entry: entry.id })
        }}
        testID="up-next"
      />
      {extras.length === 0 ? null : (
        <AddedExercises
          title="Added today"
          exercises={extras}
          sets={sets}
          current={extraInFocus?.id ?? null}
          onChoose={(id) => {
            choose({ added: id })
          }}
        />
      )}
      <Button
        title="Add exercise"
        variant="secondary"
        onPress={onAdd}
        testID="session-add-exercise"
      />
    </Stack>
  )
}
