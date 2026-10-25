import type { Exercise } from '@cedo/contract'
import { Chips, EntryEditor, IconButton, RemoveButton, Stack, Text } from '../ui/index.ts'
import {
  type DayDraft,
  type EntryAt,
  moveEntryToDay,
  moveItem,
  removeAt,
  replaceAt,
} from './plan-draft.ts'

/**
 * One entry's settings, opened from its line in the outline (#26): what it asks — the fields — and
 * what is done to it whole: up or down its day, to another day, or out of the plan — asked twice.
 * A sheet on a phone, a panel beside the outline on a desktop; each change is the whole plan, saved
 * as made. The page keeps it open by the entry's key, so it follows the entry where it moves.
 */
export function EntrySettings({
  days,
  at,
  exercise,
  onChange,
}: {
  readonly days: readonly DayDraft[]
  readonly at: EntryAt
  readonly exercise: Exercise
  readonly onChange: (days: readonly DayDraft[]) => void
}): React.JSX.Element | null {
  const day = days[at.day]
  const entry = day?.entries[at.entry]
  if (day === undefined || entry === undefined) return null
  const id = `plan-entry-${String(at.day)}-${String(at.entry)}`
  const withEntries = (entries: DayDraft['entries']) => replaceAt(days, at.day, { ...day, entries })
  const move = (to: number) => () => {
    onChange(withEntries(moveItem(day.entries, at.entry, to)))
  }

  return (
    <Stack gap="xl">
      <EntryEditor
        entry={entry}
        tracking={exercise.tracking}
        onChange={(next) => {
          onChange(withEntries(replaceAt(day.entries, at.entry, next)))
        }}
        testID={id}
      />
      <Stack gap="sm">
        <Text variant="label" tone="muted">
          In the plan
        </Text>
        {days.length > 1 ? (
          <Chips
            options={days.map((d, i) => ({ value: String(i), label: d.name }))}
            value={String(at.day)}
            onChange={(to) => {
              onChange(moveEntryToDay(days, at, Number(to)).days)
            }}
            testID={`${id}-day`}
          />
        ) : null}
        <Stack direction="row" align="center" gap="sm">
          {at.entry === 0 ? null : (
            <IconButton
              name="up"
              label="Earlier in the day"
              onPress={move(at.entry - 1)}
              testID={`${id}-up`}
            />
          )}
          {at.entry === day.entries.length - 1 ? null : (
            <IconButton
              name="down"
              label="Later in the day"
              onPress={move(at.entry + 1)}
              testID={`${id}-down`}
            />
          )}
          <Stack grow>
            <Text variant="caption" tone="muted">
              {`${String(at.entry + 1)} of ${String(day.entries.length)} on ${day.name}`}
            </Text>
          </Stack>
          <RemoveButton
            label={`Remove ${exercise.name}`}
            onRemove={() => {
              onChange(withEntries(removeAt(day.entries, at.entry)))
            }}
            testID={`${id}-remove`}
          />
        </Stack>
      </Stack>
    </Stack>
  )
}
