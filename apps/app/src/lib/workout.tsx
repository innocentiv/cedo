import { type Exercise, restOf } from '@cedo/contract'
import { Spinner, Text } from '../ui/index.ts'
import { FinishedSession } from './finished-session.tsx'
import { LoggedSets, PlanUnavailable, UnsentSets } from './session-parts.tsx'
import { AdHocDay } from './workout-adhoc.tsx'
import { PlannedDay } from './workout-day.tsx'
import type { Workout } from './workout-state.ts'

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
  const rest = {
    rest: restOf(day ?? null, w.sets.all),
    kept: session.data.rest,
    sessionId: w.id,
    sets: w.sets.all.length,
  }
  return (
    <>
      {w.error === null ? null : (
        <Text tone="danger" testID="session-error">
          {w.error}
        </Text>
      )}
      {w.plan?.reachable === false && !w.ended ? <PlanUnavailable /> : null}
      {w.ended ? (
        <FinishedSession session={session.data} logs={w.sets.server} onSaveNotes={w.saveNotes} />
      ) : day === undefined ? (
        <AdHocDay
          exercises={w.adHocExercises}
          full={w.picked}
          sets={w.sets}
          rest={rest}
          view={w.view}
          onChoose={w.choose}
          onReopen={w.reopen}
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
          sets={w.sets}
          rest={rest}
          added={w.adHocExercises}
          full={w.picked}
          view={w.view}
          onChoose={w.choose}
          onReopen={w.reopen}
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
