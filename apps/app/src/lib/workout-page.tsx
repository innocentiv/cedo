import { useState } from 'react'
import type { Workout } from '@cedo/contract'
import { Card, Columns, Screen, Sheet, Stack, Text, useLayout } from '../ui/index.ts'
import { EntrySettings } from './entry-settings.tsx'
import { ExercisePicker } from './exercise-picker.tsx'
import { withEntryAdded } from './plan-draft.ts'
import { usePlanEditor } from './use-plan-editor.ts'
import { CopyFooter, InProgress, WorkoutAdmin, useStartDay } from './workout-actions.tsx'
import { WorkoutHead } from './workout-head.tsx'
import { type EntryAt, Outline } from './workout-outline.tsx'

/**
 * A workout's page (#26): its outline, edited in place and saved as each change is made — no edit
 * mode, no Save (ADR-0022). An entry's settings open in a sheet, or in a panel beside the outline on
 * a desktop. See docs/08-frontend.md, "Editing a workout".
 */
export function WorkoutBody({
  workout,
  reread,
  goBack,
}: {
  readonly workout: Workout
  readonly reread: () => Promise<Workout | undefined>
  /** Back to where the page was opened from: after Back, or after a delete. */
  readonly goBack: () => void
}): React.JSX.Element {
  const editor = usePlanEditor(workout, reread)
  const [selected, setSelected] = useState<EntryAt | null>(null)
  const [picking, setPicking] = useState<number | null>(null)
  const desk = useLayout() === 'tablet'
  const starting = useStartDay(workout.id)
  const { days } = editor

  if (picking !== null) {
    return (
      <ExercisePicker
        onCancel={() => {
          setPicking(null)
        }}
        onPick={(exercise) => {
          editor.pick(exercise)
          const added = withEntryAdded(days, picking, exercise)
          editor.change(added.days)
          setSelected(added.at)
          setPicking(null)
        }}
      />
    )
  }

  const chosen = selected === null ? undefined : days[selected.day]?.entries[selected.entry]
  const exercise = chosen === undefined ? undefined : editor.library.get(chosen.exerciseId)
  const settings =
    selected === null || exercise === undefined ? null : (
      <EntrySettings
        days={days}
        at={selected}
        exercise={exercise}
        onChange={editor.change}
        onMoved={setSelected}
      />
    )
  const outline = (
    <>
      {starting.error === null ? null : <Text tone="danger">{starting.error}</Text>}
      <InProgress resume={starting.resume} />
      <Outline
        days={days}
        library={editor.library}
        canEdit={workout.canEdit}
        selected={selected}
        onChange={editor.change}
        onSelect={setSelected}
        onAddEntry={setPicking}
        start={starting.resume === undefined ? starting.startButton(days) : null}
      />
      <WorkoutAdmin workout={workout} onDeleted={goBack} />
    </>
  )

  return (
    <Screen
      wide
      testID="workout-detail-screen"
      footer={workout.canEdit ? undefined : <CopyFooter workoutId={workout.id} />}
    >
      <WorkoutHead
        workout={workout}
        status={workout.canEdit ? editor.status : null}
        onBack={goBack}
      />
      {desk && workout.canEdit ? (
        <Columns
          main={outline}
          side={
            <Card testID="entry-panel">
              {settings === null ? (
                <Text tone="muted">Choose an exercise to change what it asks.</Text>
              ) : (
                <Stack gap="lg">
                  <Text variant="heading">{exercise?.name}</Text>
                  {settings}
                </Stack>
              )}
            </Card>
          }
        />
      ) : (
        <Stack gap="xxl">{outline}</Stack>
      )}
      {desk ? null : (
        <Sheet
          open={settings !== null}
          onClose={() => {
            setSelected(null)
          }}
          title={exercise?.name ?? ''}
          testID="entry-sheet"
        >
          {settings}
        </Sheet>
      )}
    </Screen>
  )
}
