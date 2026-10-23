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
import { ErrorNotice, Loaded, Screen, Spinner, Text } from '../../../../src/ui/index.ts'
import {
  AdHoc,
  LoggedSets,
  PlanUnavailable,
  PlannedDay,
  SessionFooter,
  UnsentSets,
} from '../../../../src/lib/session-parts.tsx'
import {
  useLogSet,
  useRemoveLog,
  useSession,
  useSessionTargets,
  useUpdateSession,
} from '../../../../src/api/queries.ts'
import { newIdempotencyKey } from '../../../../src/api/retry.ts'
import { ExercisePicker } from '../../../../src/lib/exercise-picker.tsx'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

/**
 * The one write this screen makes. Planned and ad-hoc sets differ only in whether they name a
 * prescribed entry — `entry_id` is nullable for exactly that reason — so they share a path rather
 * than each keeping a copy of the payload. The set's number is the server's to give: it numbers
 * within the series, under the session's lock, the same way for this screen and for an AI.
 */
function useRecordSet(sessionId: string) {
  const logSet = useLogSet(sessionId)
  // Its own submission, so a set waiting for a signal never holds Finish, nor clears its refusal.
  const { submit, error } = useSubmit()
  // Held only while a set's first send is on its way, as before. Once one waits — for a signal, or
  // behind another — the next is logged behind it, the queue keeping the order. This reads the
  // LATEST set's state, which is enough: one logged behind a held-up set is itself paused.
  const busy = logSet.isPending && !logSet.isPaused && logSet.failureCount === 0
  const record = (
    exerciseId: string,
    entryId: string | null,
    values: Effort,
    rpe: number | null,
  ): void => {
    // Its key is made here, once: however many times it is sent, it is this one set (#9).
    const key = newIdempotencyKey()
    void submit(async () => {
      await logSet.mutateAsync({
        input: {
          exerciseId,
          entryId,
          weightG: values.weightG,
          reps: values.reps,
          rpe,
          durationS: values.durationS,
          distanceMm: values.distanceMm,
          isWarmup: false,
        },
        key,
      })
    })
  }

  return {
    busy,
    error,
    adHoc: (exercise: SessionExercise, values: Effort, rpe: number | null) => {
      record(exercise.id, null, values, rpe)
    },
    planned: (entry: WorkoutEntry, values: Effort, rpe: number | null) => {
      record(entry.exerciseId, entry.id, values, rpe)
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
  // Targets are for the day's entries, so they are asked for only when there is a day to show.
  const plan = session.data?.plan
  const targets = useSessionTargets(id, plan?.reachable === true)
  const removeLog = useRemoveLog(id)
  const finish = useUpdateSession(id)
  const { submit, busy, error: refused } = useSubmit()
  const record = useRecordSet(id)
  const error = record.error ?? refused

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
          busy={record.busy}
        />
      ) : targets.data === undefined ? (
        // The day waits for its targets — each logger's inputs start from them, once — and says
        // so if they fail. Its children never run: they have answered by the branch below.
        <Loaded query={targets} testID="session-targets">
          {() => null}
        </Loaded>
      ) : (
        // Once answered, the day stays: a failed refresh behind it must not take the loggers, and
        // what is typed in them, off the screen mid-set.
        <PlannedDay
          day={day}
          targets={targets.data}
          logs={logs}
          busy={record.busy}
          onLog={record.planned}
        />
      )}

      <UnsentSets sessionId={id} day={day} adHoc={adHoc.exercises} />
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
