import { useState } from 'react'
import type { Workout } from '@cedo/contract'
import { Card, Columns, Screen, Sheet, Stack, Text, useLayout } from '../ui/index.ts'
import { EntrySettings } from './entry-settings.tsx'
import { ExercisePicker } from './exercise-picker.tsx'
import { entryAt, withEntryAdded } from './plan-draft.ts'
import { usePlanEditor } from './use-plan-editor.ts'
import { CopyFooter, InProgress, WorkoutAdmin, useStartDay } from './workout-actions.tsx'
import { WorkoutHead } from './workout-head.tsx'
import { Outline } from './workout-outline.tsx'

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
  readonly reread: () => Promise<Workout | null>
  /** Back to where the page was opened from: after Back, or after a delete. */
  readonly goBack: () => void
}): React.JSX.Element {
  const editor = usePlanEditor(workout, reread)
  // By key, not position: the entry stays the one open as it moves, and closes once it is gone.
  const [selected, setSelected] = useState<string | null>(null)
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
        already={new Set(days[picking]?.entries.map((e) => e.exerciseId) ?? [])}
        onPick={(exercises) => {
          let next = days
          let last: string | null = null
          for (const exercise of exercises) {
            editor.pick(exercise)
            const added = withEntryAdded(next, picking, exercise)
            next = added.days
            last = next[added.at.day]?.entries[added.at.entry]?.key ?? null
          }
          editor.change(next)
          setSelected(last)
          setPicking(null)
        }}
      />
    )
  }

  const at = selected === null ? null : entryAt(days, selected)
  const chosen = at === null ? undefined : days[at.day]?.entries[at.entry]
  const exercise = chosen === undefined ? undefined : editor.library.get(chosen.exerciseId)
  const settings =
    at === null || exercise === undefined ? null : (
      <EntrySettings days={days} at={at} exercise={exercise} onChange={editor.change} />
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
        start={starting.start === null ? null : { onStart: starting.start, busy: starting.busy }}
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
        // Read again with another name or notes — saved elsewhere — its fields start from those.
        key={`${workout.name}\n${workout.notes ?? ''}`}
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
