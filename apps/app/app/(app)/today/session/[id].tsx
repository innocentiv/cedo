import { useLocalSearchParams } from 'expo-router'
import { useGoBack } from '../../../../src/lib/use-go-back.ts'
import { Button, ErrorNotice, Screen, SessionHeader, Spinner } from '../../../../src/ui/index.ts'
import { ExercisePicker } from '../../../../src/lib/exercise-picker.tsx'
import { sessionColumns } from '../../../../src/lib/workout.tsx'
import { useWorkout } from '../../../../src/lib/workout-state.ts'
import { HowTo, WorkoutMenu } from '../../../../src/lib/workout-sheets.tsx'

/**
 * The workout (#24): one exercise at a time, its next set large under the thumb, rest across the
 * top, the day below, the session's own header in place of the tab bar. Every rule is the
 * contract's `session-flow`; `useWorkout` reads and writes. See docs/08-frontend.md, "The workout
 * screen".
 */
export default function LiveSession(): React.JSX.Element {
  // `[id]`, not `[sessionId]`: route filenames are kebab-case like every other file.
  const { id } = useLocalSearchParams<{ id: string }>()
  const goBack = useGoBack('/today')
  const w = useWorkout(id ?? '')
  const { session } = w

  if (session.error !== null) {
    return (
      <Screen testID="session-screen">
        <ErrorNotice message={session.error.message} />
      </Screen>
    )
  }
  if (session.isPending) return <Spinner testID="session-loading" />
  if (w.picking || w.opensOnPicker) {
    return <ExercisePicker onCancel={w.cancelPicking} onPick={w.pick} already={w.inSession} />
  }

  return (
    <Screen
      testID="session-screen"
      header={
        <SessionHeader
          title={w.day?.name ?? 'Session'}
          startedAt={session.data.startedAt}
          endedAt={session.data.endedAt}
          onBack={goBack}
          onMenu={w.ended ? undefined : w.menu.show}
          testID="session-header"
        />
      }
      footer={
        w.ended ? (
          <Button title="Done" variant="secondary" onPress={goBack} testID="leave-session" />
        ) : undefined
      }
      columns={sessionColumns(w)}
    >
      <WorkoutMenu
        open={w.menu.open}
        onClose={w.menu.hide}
        ended={w.ended}
        workoutNotes={w.plan?.reachable === true ? w.plan.workoutNotes : null}
        notes={session.data.notes}
        onSaveNotes={w.saveNotes}
        onFinish={w.finish}
        busy={w.busy}
        error={w.refused}
      />
      <HowTo
        exercise={w.howTo?.exercise ?? null}
        cue={w.howTo?.cue ?? null}
        onClose={() => {
          w.setHowTo(null)
        }}
      />
    </Screen>
  )
}
