import { useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { useGoBack } from '../../../../src/lib/use-go-back.ts'
import {
  type Effort,
  type Exercise,
  type SessionExercise,
  type SetLog,
  type WorkoutEntry,
  exercisesInSession,
} from '@cedo/contract'
import { ErrorNotice, Screen, Spinner, Text } from '../../../../src/ui/index.ts'
import {
  AdHoc,
  LoggedSets,
  PlanUnavailable,
  PlannedDay,
  SessionFooter,
} from '../../../../src/lib/session-parts.tsx'
import {
  useLogSet,
  useProgression,
  useRemoveLog,
  useSession,
  useUpdateSession,
} from '../../../../src/api/queries.ts'
import { ExercisePicker } from '../../../../src/lib/exercise-picker.tsx'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

/**
 * The one write this screen makes. Planned and ad-hoc sets differ only in whether they name a
 * prescribed entry — `entry_id` is nullable for exactly that reason — so they share a path rather
 * than each keeping a copy of the payload. The set's number is the server's to give: it numbers
 * within the series, under the session's lock, the same way for this screen and for an AI.
 */
function useRecordSet(
  logSet: ReturnType<typeof useLogSet>,
  submit: ReturnType<typeof useSubmit>['submit'],
) {
  const record = (exerciseId: string, entryId: string | null, values: Effort): void => {
    void submit(async () => {
      await logSet.mutateAsync({
        exerciseId,
        entryId,
        weightG: values.weightG,
        reps: values.reps,
        rpe: null,
        durationS: values.durationS,
        distanceMm: values.distanceMm,
        isWarmup: false,
      })
    })
  }

  return {
    adHoc: (exercise: SessionExercise, values: Effort) => {
      record(exercise.id, null, values)
    },
    planned: (entry: WorkoutEntry, values: Effort) => {
      record(entry.exerciseId, entry.id, values)
    },
  }
}

/** Stable, so an absent session does not recompute the exercises on every render. */
const NO_LOGS: readonly SetLog[] = []

/**
 * The exercises shown when no plan day is: what the session has logged, then any picked since
 * (`exercisesInSession`). Picks are local and not persisted — once a set is logged, the log itself
 * carries the exercise, and that is what survives a reload.
 */
function useAdHocExercises(logs: readonly SetLog[]) {
  const [chosen, setChosen] = useState<Exercise[]>([])
  const [picking, setPicking] = useState(false)
  const exercises = useMemo(() => exercisesInSession(logs, chosen), [logs, chosen])

  return {
    exercises,
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

  const session = useSession(id)
  // Hints are for the day's entries, so they are asked for only when there is a day to show.
  const plan = session.data?.plan
  const progression = useProgression(
    plan?.reachable === true ? (session.data?.workoutId ?? '') : '',
  )
  const logSet = useLogSet(id)
  const removeLog = useRemoveLog(id)
  const finish = useUpdateSession(id)
  const { submit, busy, error } = useSubmit()
  const record = useRecordSet(logSet, submit)

  const suggestions = useMemo(
    () => new Map((progression.data ?? []).map((s) => [s.entryId, s])),
    [progression.data],
  )
  const adHoc = useAdHocExercises(session.data?.logs ?? NO_LOGS)

  if (session.error !== null) {
    return (
      <Screen testID="session-screen">
        <ErrorNotice message={session.error.message} />
      </Screen>
    )
  }
  if (session.isPending) return <Spinner testID="session-loading" />

  /**
   * The plan the session follows, as the server says the reader can reach it (`SessionPlan`) — never
   * decided here. The screen used to fetch the plan itself and took a FAILED fetch for one out of
   * reach, offering the logger of a session without a plan: the next set went into the wrong series.
   * A plan out of reach is said, inline, but never replaces the screen: the session is the user's
   * own, and losing access to a group plan must not hide their logged sets or the way to finish.
   */
  const day = plan?.reachable === true ? plan.day : undefined

  if (adHoc.picking) {
    return <ExercisePicker onCancel={adHoc.stopPicking} onPick={adHoc.choose} />
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
      {error === null ? null : (
        <Text tone="danger" testID="session-error">
          {error}
        </Text>
      )}
      {plan?.reachable === false && !ended ? <PlanUnavailable /> : null}

      {ended ? (
        <Text tone="muted" testID="session-finished">
          {`Finished. ${logs.length} ${logs.length === 1 ? 'set' : 'sets'} logged.`}
        </Text>
      ) : day === undefined ? (
        <AdHoc
          exercises={adHoc.exercises}
          onAdd={adHoc.startPicking}
          onLog={record.adHoc}
          logs={logs}
          busy={logSet.isPending}
        />
      ) : (
        <PlannedDay
          day={day}
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
