import type { Exercise } from '@cedo/contract'
import type { DayDraft, EntryDraft } from '../lib/plan-draft.ts'
import { removeAt, replaceAt } from '../lib/plan-draft.ts'
import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { EntryEditor } from './entry-editor.tsx'
import { Field, Input } from './input.tsx'
import { Stack } from './stack.tsx'

export interface DayEditorProps {
  readonly day: DayDraft
  readonly index: number
  /** The exercises this day may reference, by id. Carries the tracking mode, not just a name. */
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
            <Button title="↑" variant="ghost" onPress={onMoveUp} testID={`day-up-${index}`} />
            <Button
              title="Delete"
              variant="ghost"
              onPress={onRemove}
              testID={`day-remove-${index}`}
            />
          </Stack>
        </Field>

        {day.entries.map((entry, entryIndex) => (
          <EntryEditor
            key={`entry-${index}-${entryIndex}`}
            entry={entry}
            exerciseName={library.get(entry.exerciseId)?.name ?? 'Exercise'}
            tracking={library.get(entry.exerciseId)?.tracking ?? 'weight_reps'}
            testID={`plan-entry-${index}-${entryIndex}`}
            onChange={(next) => {
              setEntries(replaceAt(day.entries, entryIndex, next))
            }}
            onRemove={() => {
              setEntries(removeAt(day.entries, entryIndex))
            }}
          />
        ))}

        <Button
          title="Add exercise"
          variant="secondary"
          onPress={onAddEntry}
          testID={`add-entry-${index}`}
        />
      </Stack>
    </Card>
  )
}
