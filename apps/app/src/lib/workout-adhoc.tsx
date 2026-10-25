import { useState } from 'react'
import {
  type SessionExercise,
  type SetLog,
  adHocSetsOf,
  formatSets,
  markedSets,
  nextSet,
  nextSetWords,
} from '@cedo/contract'
import type { PendingLog } from '../api/pending.ts'
import { Button, FocusLogger, Stack, UpNext } from '../ui/index.ts'
import type { useRecordSet } from './record-set.ts'
import { ShownSet, useShown } from './shown-set.tsx'
import { useWeightUnit } from './weight-unit.ts'

/**
 * A session with no plan behind it (#24): the exercise in focus — the one chosen, else the one added
 * or logged last — its sets so far and one more, starting from the last; the others below; and Add
 * exercise, which is also how a planned session takes a swap when a machine is taken. Nothing was
 * prescribed, so there is always a next set until the athlete moves on.
 */
export function AdHocDay({
  exercises,
  serverLogs,
  logs,
  waiting,
  record,
  onUndo,
  onAdd,
}: {
  /** What the session has logged, then anything picked since — `exercisesInSession`. */
  readonly exercises: readonly SessionExercise[]
  readonly serverLogs: readonly SetLog[]
  readonly logs: readonly PendingLog[]
  readonly waiting: ReadonlySet<string>
  readonly record: ReturnType<typeof useRecordSet>
  readonly onUndo: (logId: string) => void
  readonly onAdd: () => void
}): React.JSX.Element {
  const unit = useWeightUnit()
  const latest = logs.at(-1)?.id ?? null
  const shown = useShown(latest)
  const [chosen, setChosen] = useState<string>()
  const focus = exercises.find((e) => e.id === chosen) ?? exercises.at(-1)
  const adHoc = logs.filter((l) => l.entryId === null)
  const shownLog = adHoc.at(-1) ?? null
  const exerciseOf = (id: string | undefined) => exercises.find((e) => e.id === id) ?? null

  return (
    <Stack gap="xl" testID="session-adhoc">
      <ShownSet
        log={shownLog}
        exercise={exerciseOf(shownLog?.exerciseId)}
        serverLogs={serverLogs}
        waiting={waiting}
        record={record}
        onUndo={onUndo}
      />
      {focus === undefined ? null : (
        <AdHocFocus
          exercise={focus}
          logs={logs}
          waiting={waiting}
          latest={latest}
          selected={shown.key}
          onSelect={shown.select}
          record={record}
        />
      )}
      <UpNext
        items={exercises.map((exercise) => ({
          id: exercise.id,
          name: exercise.name,
          detail: formatSets(
            adHoc.filter((l) => l.exerciseId === exercise.id),
            exercise.tracking,
            unit,
          ),
          progress: `${adHoc.filter((l) => l.exerciseId === exercise.id).length} done`,
          done: false,
          superset: null,
        }))}
        current={focus?.id ?? null}
        onChoose={setChosen}
        testID="adhoc-row"
      />
      <Button
        title="Add exercise"
        variant="secondary"
        onPress={onAdd}
        testID="adhoc-add-exercise"
      />
    </Stack>
  )
}

function AdHocFocus({
  exercise,
  logs,
  waiting,
  latest,
  selected,
  onSelect,
  record,
}: {
  readonly exercise: SessionExercise
  readonly logs: readonly PendingLog[]
  readonly waiting: ReadonlySet<string>
  readonly latest: string | null
  readonly selected: string | null
  readonly onSelect: (key: string) => void
  readonly record: ReturnType<typeof useRecordSet>
}): React.JSX.Element {
  const sets = adHocSetsOf(exercise.id, logs)
  const next = nextSet(sets)
  const words = nextSetWords(sets, next, false)
  return (
    <FocusLogger
      key={`${exercise.id}:${latest ?? ''}`}
      name={exercise.name}
      cue={null}
      tracking={exercise.tracking}
      sets={markedSets(sets, waiting)}
      selected={selected}
      onSelect={onSelect}
      next={{
        target: next?.target ?? {
          reps: null,
          weightG: null,
          rpe: null,
          durationS: null,
          distanceMm: null,
        },
        isWarmup: false,
        title: words.title,
        action: words.action,
      }}
      progressed={null}
      last={null}
      busy={record.busy}
      onLog={(effort, isWarmup) => {
        record.log({ exerciseId: exercise.id, entryId: null, effort, isWarmup })
      }}
      testID={`adhoc-${exercise.id}`}
    />
  )
}
