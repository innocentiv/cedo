import {
  type EntryTarget,
  type Exercise,
  type Rest,
  type SessionDay,
  type SessionExercise,
  formatPrescription,
  nextSet,
  progressOf,
} from '@cedo/contract'
import { AddRow, Columns, Stack, UpNext } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { JustDone, ShownSet } from './shown-set.tsx'
import { AddedExercises } from './workout-adhoc.tsx'
import { InFocus, usePlannedFocus } from './workout-focus.tsx'
import type { WorkoutSets } from './workout-state.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * A session that follows a plan's day (#24): what was just done and the entry in focus, then the
 * rest of the day, what was added to it, and every set — side by side on a desktop. Every rule is the contract's `session-flow`; this holds only what the
 * athlete chose to look at, until the next set is logged. See docs/08-frontend.md.
 */
export function PlannedDay({
  day,
  targets,
  sets,
  rest,
  extras,
  full,
  added,
  record,
  onAdd,
  onHowTo,
  onFinish,
  finishing,
}: {
  readonly day: SessionDay
  readonly targets: readonly EntryTarget[]
  readonly sets: WorkoutSets
  readonly rest: Rest | null
  /** Exercises logged with no entry — swaps — then any added since: `exercisesInSession`. */
  readonly extras: readonly SessionExercise[]
  /** The exercises added this open, whole: how to do them can be shown. */
  readonly full: readonly Exercise[]
  readonly added: string | null
  /** Every set the session holds, under the day. */
  readonly record: React.ReactNode
  readonly onAdd: () => void
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly onFinish: () => Promise<void>
  readonly finishing: boolean
}): React.JSX.Element {
  const unit = useWeightUnit()
  const focused = usePlannedFocus(day, targets, sets, extras, added)
  const { choose, setsFor, extraInFocus, focus, shown, shownEntry, another } = focused
  const add = <AddRow title="Add exercise" onPress={onAdd} testID="session-add-exercise" />

  return (
    <Columns
      main={
        <>
          <JustDone rest={rest}>
            {shown === null ? null : (
              <ShownSet
                log={shown}
                exercise={
                  shownEntry?.exercise ?? extras.find((e) => e.id === shown.exerciseId) ?? null
                }
                sets={sets}
                onAnother={
                  another === null
                    ? undefined
                    : () => {
                        choose({ entry: another })
                      }
                }
              />
            )}
          </JustDone>
          <InFocus
            focused={focused}
            sets={sets}
            full={full}
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
              current={extraInFocus !== undefined || focus === null ? null : String(focus.index)}
              onChoose={(index) => {
                const entry = day.entries.find((e) => String(e.index) === index)
                if (entry !== undefined) choose({ entry: entry.id })
              }}
              testID="up-next"
            />
            {extras.length === 0 ? add : null}
          </Stack>
          {extras.length === 0 ? null : (
            <Stack gap="xs">
              <AddedExercises
                title="Added today"
                exercises={extras}
                sets={sets}
                current={extraInFocus?.id ?? null}
                onChoose={(id) => {
                  choose({ added: id })
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
