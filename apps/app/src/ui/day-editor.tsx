import { type Exercise, canAddEntry } from '@cedo/contract'
import { exerciseName } from '../lib/exercise-name.ts'
import { type DayDraft, type EntryDraft, removeAt, replaceAt } from '../lib/plan-draft.ts'
import { Button } from './button.tsx'
import { IconButton } from './icon.tsx'
import { Card } from './card.tsx'
import { EntryEditor } from './entry-editor.tsx'
import { Field, Input } from './input.tsx'
import { Stack } from './stack.tsx'
import { UnavailableEntry } from './unavailable-entry.tsx'

export interface DayEditorProps {
  readonly day: DayDraft
  readonly index: number
  /**
   * Every exercise the editor can see, by id — the plan's own, as resolved, and any picked since.
   * Carries the tracking mode, not just a name. An id missing from it is an UNAVAILABLE exercise:
   * the same map `planIssues` is given, so the entry and the footer agree.
   */
  readonly library: ReadonlyMap<string, Exercise>
  readonly onChange: (day: DayDraft) => void
  readonly onMoveUp: () => void
  readonly onRemove: () => void
  readonly onAddEntry: () => void
}

/** One day of a plan. Entry edits are folded here so the editor screen only manages the day list. */
export function DayEditor({
  day,
  index,
  library,
  onChange,
  onMoveUp,
  onRemove,
  onAddEntry,
}: DayEditorProps): React.JSX.Element {
  const setEntries = (entries: EntryDraft[]) => {
    onChange({ ...day, entries })
  }

  return (
    <Card testID={`plan-day-${index}`}>
      <Stack gap="md">
        <Field label={`Day ${index + 1}`}>
          <Stack direction="row" gap="sm" align="center">
            <Stack grow>
              <Input
                value={day.name}
                onChangeText={(name) => {
                  onChange({ ...day, name })
                }}
                autoCapitalize="sentences"
                testID={`day-name-${index}`}
              />
            </Stack>
            <IconButton
              name="up"
              label="Move the day up"
              onPress={onMoveUp}
              testID={`day-up-${index}`}
            />
            <IconButton
              name="remove"
              label="Remove the day"
              edge="end"
              onPress={onRemove}
              testID={`day-remove-${index}`}
            />
          </Stack>
        </Field>

        {day.entries.map((entry, entryIndex) => {
          const exercise = library.get(entry.exerciseId)
          const testID = `plan-entry-${index}-${entryIndex}`
          const removeEntry = () => {
            setEntries(removeAt(day.entries, entryIndex))
          }
          // An exercise the editor cannot see is unavailable: no mode, so no target inputs.
          return exercise === undefined ? (
            <UnavailableEntry
              key={`entry-${index}-${entryIndex}`}
              entry={entry}
              exerciseName={exerciseName(exercise)}
              onRemove={removeEntry}
              testID={testID}
            />
          ) : (
            <EntryEditor
              key={`entry-${index}-${entryIndex}`}
              entry={entry}
              exerciseName={exercise.name}
              tracking={exercise.tracking}
              testID={testID}
              onChange={(next) => {
                setEntries(replaceAt(day.entries, entryIndex, next))
              }}
              onRemove={removeEntry}
            />
          )
        })}

        <Button
          title="Add exercise"
          variant="secondary"
          disabled={!canAddEntry(day)}
          onPress={onAddEntry}
          testID={`add-entry-${index}`}
        />
      </Stack>
    </Card>
  )
}
