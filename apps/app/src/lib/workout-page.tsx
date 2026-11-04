import { useState } from 'react'
import type { Workout } from '@cedo/contract'
import { Card, Screen, Sheet, Stack, Text, useLayout } from '../ui/index.ts'
import { EntrySettings } from './entry-settings.tsx'
import { ExercisePicker } from './exercise-picker.tsx'
import { entryAt, withEntriesAdded } from './plan-draft.ts'
import { usePlanEditor } from './use-plan-editor.ts'
import {
  CopyFooter,
  DeleteWorkout,
  InProgress,
  WorkoutOwnership,
  useStartDay,
} from './workout-actions.tsx'
import { WorkoutHead, WorkoutTitle } from './workout-head.tsx'
import { Outline } from './workout-outline.tsx'

/**
 * A workout's page (#26): its outline, edited in place and saved as each change is made — no edit
 * mode, no Save (ADR-0022). An entry's settings open in a sheet, or in a pane beside the outline on
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
          for (const exercise of exercises) editor.pick(exercise)
          const added = withEntriesAdded(days, picking, exercises)
          editor.change(added.days)
          setSelected(added.first)
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
      <EntrySettings
        key={selected ?? ''}
        workoutId={workout.id}
        canEdit={workout.canEdit}
        days={days}
        at={at}
        exercise={exercise}
        onChange={editor.change}
      />
    )
  const outline = (
    <>
      {starting.error === null ? null : <Text tone="danger">{starting.error}</Text>}
      <InProgress resume={starting.resume} />
      <Outline
        days={days}
        library={editor.library}
        workoutId={workout.id}
        canEdit={workout.canEdit}
        selected={selected}
        onChange={editor.change}
        onSelect={setSelected}
        onAddEntry={setPicking}
        start={starting.start === null ? null : { onStart: starting.start, busy: starting.busy }}
      />
      {workout.canEdit ? <DeleteWorkout workoutId={workout.id} onDeleted={goBack} /> : null}
    </>
  )

  const page = (
    <Stack gap="lg">
      <WorkoutOwnership workout={workout} />
      <WorkoutHead
        // Notes saved elsewhere are shown by `WrittenNotes` itself — unless they are being written
        // here: no key on them, which would remount it and lose the words being typed (#51).
        workout={workout}
        status={workout.canEdit ? editor.status : null}
      />
      <Stack gap="xxl">{outline}</Stack>
    </Stack>
  )
  return (
    <Screen
      testID="workout-detail-screen"
      ownHeading={
        <WorkoutTitle
          // Read again with another name — saved elsewhere — its field starts from that.
          key={workout.name}
          workout={workout}
          canEdit={workout.canEdit}
          onBack={goBack}
        />
      }
      footer={workout.canEdit ? undefined : <CopyFooter workoutId={workout.id} />}
      // On a desktop the entry's pane beside the outline, each its own scroll: an entry on the last
      // day opens beside it, not at the top of the page (#50). The name and Back are the screen's
      // heading, pinned over both; the notes scroll with the outline, so a long note takes no
      // height from the pane. A reader opens an entry too: the plan said, and their own target.
      columns={{
        main: page,
        pane: <EntryPane name={exercise?.name}>{settings}</EntryPane>,
        chosen: selected,
      }}
    >
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

/** The entry chosen, beside the outline on a desktop: its settings, or a line until there is one. */
function EntryPane({
  name,
  children,
}: {
  readonly name: string | undefined
  /** Its settings, or `null` while nothing is chosen. */
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <Card testID="entry-panel">
      {children === null ? (
        <Text tone="muted">Choose an exercise to change what it asks.</Text>
      ) : (
        <Stack gap="lg">
          <Text variant="heading">{name}</Text>
          {children}
        </Stack>
      )}
    </Card>
  )
}
