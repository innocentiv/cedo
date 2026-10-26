import {
  type Exercise,
  NO_TARGET,
  type Rest,
  type SessionExercise,
  adHocSetsOf,
  markedSets,
  nextSet,
  nextSetWords,
  progressOf,
} from '@cedo/contract'
import type { PendingLog } from '../api/pending.ts'
import { AddRow, Columns, FocusLogger, Stack, UpNext } from '../ui/index.ts'
import { JustDone, type Reopened, ShownSet } from './shown-set.tsx'
import { useLoads } from './use-loads.ts'
import { useUntilNextSet } from './until-next-set.ts'
import type { WorkoutSets } from './workout-state.ts'

/**
 * The exercise a set logged with no plan entry goes to (#24): the one chosen, else one just added
 * and not yet logged — each exercise added becomes the focus — else that of the set logged last,
 * else the last there is.
 */
export function adHocFocus(
  exercises: readonly SessionExercise[],
  all: readonly PendingLog[],
  chosen: string | null,
  added: string | null,
): SessionExercise | undefined {
  const of = (id: string | null | undefined) => exercises.find((e) => e.id === id)
  const fresh = added !== null && !all.some((l) => l.exerciseId === added) ? added : null
  const latest = all.at(-1)
  return (
    of(chosen) ??
    of(fresh) ??
    (latest?.entryId === null ? of(latest.exerciseId) : undefined) ??
    exercises.at(-1)
  )
}

/**
 * A session with no plan behind it (#24): what was just done and the exercise in focus, then the
 * others, Add exercise, and every set — side by side on a desktop. Nothing was prescribed, so there is always a next set until the athlete
 * moves on.
 */
export function AdHocDay({
  exercises,
  full,
  sets,
  rest,
  added,
  record,
  onAdd,
  onHowTo,
}: {
  /** What the session has logged, then anything picked since — `exercisesInSession`. */
  readonly exercises: readonly SessionExercise[]
  /** The exercises picked this open, whole: how to do them can be shown. */
  readonly full: readonly Exercise[]
  readonly sets: WorkoutSets
  readonly rest: Rest | null
  readonly added: string | null
  /** Every set the session holds, under its exercises. */
  readonly record: React.ReactNode
  readonly onAdd: () => void
  readonly onHowTo: (exercise: Exercise) => void
}): React.JSX.Element {
  const latest = sets.all.at(-1)?.id ?? null
  const [chosen, choose] = useUntilNextSet<string>(latest)
  const [reopened, reopen] = useUntilNextSet<Reopened>(latest)
  const focus = adHocFocus(exercises, sets.all, chosen, added)
  const shown =
    reopened === null
      ? (sets.all.findLast((l) => l.entryId === null) ?? null)
      : (adHocSetsOf(reopened.exerciseId, sets.all).find((s) => s.key === reopened.key)?.log ??
        null)

  return (
    <Columns
      testID="session-adhoc"
      main={
        <>
          <JustDone rest={rest}>
            {shown === null ? null : (
              <ShownSet
                log={shown}
                exercise={exercises.find((e) => e.id === shown.exerciseId) ?? null}
                sets={sets}
              />
            )}
          </JustDone>
          {focus === undefined ? null : (
            <AdHocFocus
              exercise={focus}
              whole={full.find((e) => e.id === focus.id)}
              sets={sets}
              selected={reopened?.exerciseId === focus.id ? reopened.key : null}
              onSelect={(key) => {
                reopen({ entryId: null, exerciseId: focus.id, key })
              }}
              onHowTo={onHowTo}
            />
          )}
        </>
      }
      side={
        <>
          <Stack gap="xs">
            <AddedExercises
              exercises={exercises}
              sets={sets}
              current={focus?.id ?? null}
              onChoose={choose}
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
  whole,
  sets,
  selected,
  onSelect,
  onHowTo,
}: {
  readonly exercise: SessionExercise
  /** The whole exercise, when it was picked this open: how to do it can be shown. */
  readonly whole: Exercise | undefined
  readonly sets: WorkoutSets
  readonly selected: string | null
  readonly onSelect: (key: string) => void
  readonly onHowTo: (exercise: Exercise) => void
}): React.JSX.Element {
  const marks = adHocSetsOf(exercise.id, sets.all)
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
