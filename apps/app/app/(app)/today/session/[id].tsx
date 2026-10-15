import { useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { useGoBack } from '../../../../src/lib/use-go-back.ts'
import { type Exercise, type SetLog, type WorkoutEntry, nextSetIndex } from '@cedo/contract'
import { ErrorNotice, type LoggedValues, Screen, Spinner, Text } from '../../../../src/ui/index.ts'
import { AdHoc, LoggedSets, PlannedDay, SessionFooter } from '../../../../src/lib/session-parts.tsx'
import {
  useLogSet,
  useProgression,
  useRemoveLog,
  useSession,
  useUpdateSession,
  useWorkout,
} from '../../../../src/api/queries.ts'
import { ExercisePicker } from '../../../../src/lib/exercise-picker.tsx'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

/**
 * The one write this screen makes. Planned and ad-hoc sets differ only in whether they name a
 * prescribed entry — `entry_id` is nullable for exactly that reason — so they share a path rather
 * than each keeping a copy of the payload.
 */
function useRecordSet(
  logSet: ReturnType<typeof useLogSet>,
  submit: ReturnType<typeof useSubmit>['submit'],
  logs: readonly SetLog[],
) {
  const record = (
    exerciseId: string,
    entryId: string | null,
    setIndex: number,
    values: LoggedValues,
  ): void => {
    void submit(async () => {
      await logSet.mutateAsync({
        exerciseId,
        entryId,
        setIndex,
        weightG: values.weightG,
        reps: values.reps,
        rpe: null,
        durationS: values.durationS,
        distanceMm: values.distanceMm,
        isWarmup: false,
      })
    })
  }

  // Each series is numbered by `nextSetIndex`, never by counting — see its comment.
  return {
    adHoc: (exercise: Exercise, values: LoggedValues) => {
      const series = logs.filter((l) => l.exerciseId === exercise.id)
      record(exercise.id, null, nextSetIndex(series), values)
    },
    planned: (entry: WorkoutEntry, values: LoggedValues) => {
      const series = logs.filter((l) => l.entryId === entry.id)
      record(entry.exerciseId, entry.id, nextSetIndex(series), values)
    },
  }
}

/**
 * Which exercises an ad-hoc session is working through. Local, not persisted: the logs themselves
 * are the record, and re-picking after a reload continues where it left off.
 */
function useAdHocExercises() {
  const [chosen, setChosen] = useState<Exercise[]>([])
  const [picking, setPicking] = useState(false)

  return {
    chosen,
    picking,
    startPicking: () => {
      setPicking(true)
    },
    stopPicking: () => {
      setPicking(false)
    },
    choose: (exercise: Exercise) => {
      setChosen((current) =>
        current.some((e) => e.id === exercise.id) ? current : [...current, exercise],
      )
      setPicking(false)
    },
  }
}

export default function LiveSession(): React.JSX.Element {
  // `[id]`, not `[sessionId]`: route filenames are kebab-case like every other file, and a
  // camelCase segment cannot be spelled that way.
  const { id: sessionId } = useLocalSearchParams<{ id: string }>()
  const goBack = useGoBack('/today')
  const id = sessionId ?? ''

  const { chosen, picking, startPicking, stopPicking, choose } = useAdHocExercises()

  const session = useSession(id)
  const workoutId = session.data?.workoutId ?? ''
  const workout = useWorkout(workoutId)
  const progression = useProgression(workoutId)
  const logSet = useLogSet(id)
  const removeLog = useRemoveLog(id)
  const finish = useUpdateSession(id)
  const { submit, busy, error } = useSubmit()
  const record = useRecordSet(logSet, submit, session.data?.logs ?? [])

  const day = useMemo(
    () => workout.data?.days.find((d) => d.id === session.data?.dayId),
    [workout.data, session.data],
  )
  const suggestions = useMemo(
    () => new Map((progression.data ?? []).map((s) => [s.entryId, s])),
    [progression.data],
  )

  if (session.error !== null) {
    return (
      <Screen testID="session-screen">
        <ErrorNotice message={session.error.message} />
      </Screen>
    )
  }
  if (session.isPending) return <Spinner testID="session-loading" />

  /**
   * A planned session waits for its plan. Rendering on "no day found" alone showed the ad-hoc
   * logger while the plan was still loading — "No plan behind this one" — and, if it failed to
   * load, logged sets with no plan entry and never said why.
   */
  const planned = session.data.workoutId !== null && session.data.dayId !== null
  if (planned && workout.error !== null) {
    return (
      <Screen testID="session-screen">
        <ErrorNotice message={workout.error.message} />
      </Screen>
    )
  }
  if (planned && workout.isPending) return <Spinner testID="session-loading" />

  if (picking) {
    return <ExercisePicker onCancel={stopPicking} onPick={choose} />
  }

  const logs = session.data.logs
  const ended = session.data.endedAt !== null

  return (
    <Screen
      title={day?.name ?? 'Session'}
      testID="session-screen"
      footer={
        <SessionFooter
          ended={ended}
          busy={busy}
          onLeave={() => {
            goBack()
          }}
          onFinish={() => {
            void submit(async () => {
              await finish.mutateAsync({ endedAt: new Date().toISOString() })
              goBack()
            })
          }}
        />
      }
    >
      {error === null ? null : <Text tone="danger">{error}</Text>}

      {ended ? (
        <Text tone="muted" testID="session-finished">
          {`Finished. ${logs.length} ${logs.length === 1 ? 'set' : 'sets'} logged.`}
        </Text>
      ) : day === undefined ? (
        <AdHoc
          chosen={chosen}
          onAdd={startPicking}
          onLog={record.adHoc}
          logs={logs}
          busy={logSet.isPending}
        />
      ) : (
        <PlannedDay
          day={day}
          logs={logs}
          suggestions={suggestions}
          busy={logSet.isPending}
          onLog={record.planned}
        />
      )}

      <LoggedSets
        logs={logs}
        editable={!ended}
        onRemove={(logId) => {
          // Through `submit`: a set finished on another device answers 404, and the row would
          // otherwise just sit there while the user tapped it again.
          void submit(async () => {
            await removeLog.mutateAsync(logId)
          })
        }}
      />
    </Screen>
  )
}
