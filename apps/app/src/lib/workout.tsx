import { type Exercise, restOf } from '@cedo/contract'
import { Columns, Spinner, Text } from '../ui/index.ts'
import { LoggedSets, PlanUnavailable, SetsByExercise, UnsentSets } from './session-parts.tsx'
import { AdHocDay } from './workout-adhoc.tsx'
import { PlannedDay } from './workout-day.tsx'
import type { Workout } from './workout-state.ts'
import { FinishedSummary, SessionNotes } from './workout-summary.tsx'

/** The session's body: the day in progress, or what it came to; beside it, every set it holds. */
export function WorkoutBody({ w }: { readonly w: Workout }): React.JSX.Element | null {
  const { session, day } = w
  if (session.data === undefined) return null
  const showHowTo = (exercise: Exercise, cue: string | null) => {
    w.setHowTo({ exercise, cue })
  }
  const record = (
    <>
      <UnsentSets sessionId={w.id} day={day} adHoc={w.adHocExercises} />
      <LoggedSets logs={w.sets.server} onRemove={w.undo} />
    </>
  )
  const rest = restOf(day ?? null, w.sets.all)
  return (
    <>
      {w.error === null ? null : (
        <Text tone="danger" testID="session-error">
          {w.error}
        </Text>
      )}
      {w.plan?.reachable === false && !w.ended ? <PlanUnavailable /> : null}
      {w.ended ? (
        <Columns
          main={
            <>
              <FinishedSummary session={session.data} />
              <SessionNotes notes={session.data.notes} onSave={w.saveNotes} />
            </>
          }
          side={<SetsByExercise logs={w.sets.server} />}
        />
      ) : day === undefined ? (
        <AdHocDay
          exercises={w.adHocExercises}
          full={w.picked}
          sets={w.sets}
          rest={rest}
          added={w.added}
          record={record}
          onAdd={w.startPicking}
          onHowTo={(exercise) => {
            showHowTo(exercise, null)
          }}
        />
      ) : w.targets.data === undefined ? (
        <Spinner testID="session-targets-loading" />
      ) : (
        <PlannedDay
          day={day}
          targets={w.targets.data}
          sets={w.sets}
          rest={rest}
          extras={w.adHocExercises}
          full={w.picked}
          added={w.added}
          record={record}
          onAdd={w.startPicking}
          onHowTo={showHowTo}
          onFinish={w.finish}
          finishing={w.busy}
        />
      )}
    </>
  )
}
