import { restingAfter } from '@cedo/contract'
import { RestBand, Spinner, Text } from '../ui/index.ts'
import { LoggedSets, PlanUnavailable, UnsentSets } from './session-parts.tsx'
import { AdHocDay } from './workout-adhoc.tsx'
import { PlannedDay } from './workout-day.tsx'
import type { Workout } from './workout-state.ts'
import { FinishedSummary } from './workout-summary.tsx'

/** The session's body: the day in progress, or what it came to; then every set it holds. */
export function WorkoutBody({ w }: { readonly w: Workout }): React.JSX.Element | null {
  const { session, day } = w
  if (session.data === undefined) return null
  return (
    <>
      {w.error === null ? null : (
        <Text tone="danger" testID="session-error">
          {w.error}
        </Text>
      )}
      {w.plan?.reachable === false && !w.ended ? <PlanUnavailable /> : null}
      {w.ended ? (
        <FinishedSummary session={session.data} />
      ) : day === undefined ? (
        <AdHocDay
          exercises={w.adHocExercises}
          serverLogs={w.serverLogs}
          logs={w.logs}
          waiting={w.waiting}
          record={w.record}
          onUndo={w.undo}
          onAdd={() => {
            w.setPicking(true)
          }}
        />
      ) : w.targets.data === undefined ? (
        <Spinner testID="session-targets-loading" />
      ) : (
        <>
          <RestBand logs={w.logs} entry={restingAfter(day, w.logs)} testID="rest-band" />
          <PlannedDay
            day={day}
            targets={w.targets.data}
            serverLogs={w.serverLogs}
            logs={w.logs}
            waiting={w.waiting}
            record={w.record}
            onUndo={w.undo}
            onHowTo={(exercise) => {
              w.setHowTo({
                exercise,
                cue: day.entries.find((e) => e.exerciseId === exercise.id)?.cue ?? null,
              })
            }}
            onFinish={w.finish}
            finishing={w.busy}
          />
        </>
      )}
      <UnsentSets sessionId={w.id} day={day} adHoc={w.adHocExercises} />
      <LoggedSets logs={w.serverLogs} editable={!w.ended} onRemove={w.undo} />
    </>
  )
}
