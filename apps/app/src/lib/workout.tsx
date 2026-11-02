import { type Exercise, restOf } from '@cedo/contract'
import { type ScreenColumns, Spinner, Text } from '../ui/index.ts'
import { FinishedMain, FinishedSide } from './finished-session.tsx'
import { LoggedSets, PlanUnavailable, UnsentSets } from './session-parts.tsx'
import { AdHocMain, AdHocSide, type AdHocDayProps } from './workout-adhoc.tsx'
import { PlannedMain, PlannedSide, type PlannedDayProps } from './workout-day.tsx'
import type { Workout } from './workout-state.ts'

/**
 * The session's body as the screen's two columns (#50): the day in progress, or what it came to;
 * beside it, every set it holds. A plain function of the session's state, not a component — each
 * column is its own, which reads what it needs.
 */
export function sessionColumns(w: Workout): ScreenColumns | undefined {
  const { session, day } = w
  if (session.data === undefined) return undefined
  const notices = (
    <>
      {w.error === null ? null : (
        <Text tone="danger" testID="session-error">
          {w.error}
        </Text>
      )}
      {w.plan?.reachable === false && !w.ended ? <PlanUnavailable /> : null}
    </>
  )
  const columns = (main: React.ReactNode, side: React.ReactNode): ScreenColumns => ({
    main: (
      <>
        {notices}
        {main}
      </>
    ),
    side,
  })

  if (w.ended) {
    return columns(
      <FinishedMain session={session.data} onSaveNotes={w.saveNotes} />,
      <FinishedSide session={session.data} logs={w.sets.server} />,
    )
  }
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
  if (day === undefined) {
    const adHoc: AdHocDayProps = {
      exercises: w.adHocExercises,
      full: w.picked,
      sets: w.sets,
      rest,
      view: w.view,
      onChoose: w.choose,
      onReopen: w.reopen,
      record,
      onAdd: w.startPicking,
      onHowTo: (exercise) => {
        showHowTo(exercise, null)
      },
    }
    return columns(<AdHocMain {...adHoc} />, <AdHocSide {...adHoc} />)
  }
  if (w.targets.data === undefined) {
    return columns(<Spinner testID="session-targets-loading" />, null)
  }
  const planned: PlannedDayProps = {
    day,
    sets: w.sets,
    rest,
    added: w.adHocExercises,
    full: w.picked,
    view: w.view,
    onChoose: w.choose,
    onReopen: w.reopen,
    record,
    onAdd: w.startPicking,
    onHowTo: showHowTo,
    onFinish: w.finish,
    finishing: w.busy,
  }
  return columns(<PlannedMain {...planned} />, <PlannedSide {...planned} />)
}
