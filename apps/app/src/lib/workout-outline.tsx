import { type Exercise, canAddDay, canAddEntry, canRemoveDay, newDay } from '@cedo/contract'
import { AddRow, Button, Stack, Text } from '../ui/index.ts'
import { DayHead, type DayMoves, EntryLine } from './outline-parts.tsx'
import { type DayDraft, keyDay, moveItem, removeAt, replaceAt } from './plan-draft.ts'
import { useTargetsById } from './use-entry-target.ts'

/**
 * A workout's page is its outline (#26): days, and each entry one line — "Barbell Back Squat · 5 × 5
 * · 100 kg · Linear, +2.5 kg". A line opens the entry's settings; a day is renamed where its name
 * is, moved or removed beside it, and given another exercise at its foot. Every change goes to
 * `onChange` whole, to be saved as made (ADR-0022). Read-only for a reader: the same outline, an
 * entry opening to what it asks and their own target, nothing else to change but Start. See docs/08-frontend.md, "Editing a workout".
 */
export function Outline({
  days,
  workoutId,
  library,
  canEdit,
  selected,
  onChange,
  onSelect,
  onAddEntry,
  start,
}: {
  readonly days: readonly DayDraft[]
  readonly library: ReadonlyMap<string, Exercise>
  /** Whose targets each line says, where one differs from the plan (ADR-0026). */
  readonly workoutId: string
  readonly canEdit: boolean
  /** The entry whose settings are open, by its key: it stays the one open as the plan moves. */
  readonly selected: string | null
  readonly onChange: (days: readonly DayDraft[]) => void
  readonly onSelect: (entryKey: string) => void
  readonly onAddEntry: (day: number) => void
  /**
   * Start, beside each saved day — none while a session is in progress, or before it is known; a day
   * not saved yet has no id to start from, and gets its Start once it is.
   */
  readonly start: { readonly onStart: (dayId: string) => void; readonly busy: boolean } | null
}): React.JSX.Element {
  const targets = useTargetsById(workoutId)
  const movesOf = (d: number): DayMoves => ({
    up:
      d === 0
        ? undefined
        : () => {
            onChange(moveItem(days, d, d - 1))
          },
    down:
      d === days.length - 1
        ? undefined
        : () => {
            onChange(moveItem(days, d, d + 1))
          },
    remove: canRemoveDay(days)
      ? () => {
          onChange(removeAt(days, d))
        }
      : undefined,
  })
  return (
    <Stack gap="xxl" testID="plan-outline">
      {days.map((day, d) => (
        <Stack key={day.key} gap="xs" testID={`plan-day-${String(d)}`}>
          <DayHead
            name={day.name}
            index={d}
            canEdit={canEdit}
            onRename={(name) => {
              onChange(replaceAt(days, d, { ...day, name }))
            }}
            moves={movesOf(d)}
            start={
              start === null || day.id === undefined ? null : (
                <Button
                  title="Start"
                  variant="secondary"
                  size="small"
                  busy={start.busy}
                  onPress={() => {
                    if (day.id !== undefined) start.onStart(day.id)
                  }}
                  testID={`start-day-${String(d)}`}
                />
              )
            }
          />
          {day.entries.length === 0 ? <Text tone="muted">No exercises yet.</Text> : null}
          {day.entries.map((entry, e) => (
            <EntryLine
              key={entry.key}
              entry={entry}
              exercise={library.get(entry.exerciseId)}
              own={entry.id === undefined ? undefined : targets.get(entry.id)}
              current={selected === entry.key}
              // A reader opens it too: the plan said, and their own target to change.
              onPress={() => {
                onSelect(entry.key)
              }}
              onRemove={
                canEdit
                  ? () => {
                      onChange(replaceAt(days, d, { ...day, entries: removeAt(day.entries, e) }))
                    }
                  : undefined
              }
              at={{ day: d, entry: e }}
            />
          ))}
          {canEdit && canAddEntry(day) ? (
            <AddRow
              title="Add exercise"
              onPress={() => {
                onAddEntry(d)
              }}
              testID={`add-entry-${String(d)}`}
            />
          ) : null}
        </Stack>
      ))}
      {canEdit && canAddDay(days) ? (
        <AddRow
          title="Add day"
          onPress={() => {
            onChange([...days, keyDay(newDay(days.length))])
          }}
          testID="add-day"
        />
      ) : null}
    </Stack>
  )
}
