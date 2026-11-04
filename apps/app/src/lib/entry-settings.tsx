import { type Exercise, type ProgressionSuggestion, restPlace } from '@cedo/contract'
import {
  Choice,
  EntryEditor,
  EntryRead,
  IconButton,
  RemoveButton,
  Stack,
  Text,
} from '../ui/index.ts'
import {
  type DayDraft,
  type EntryAt,
  type EntryDraft,
  moveEntryToDay,
  moveItem,
  removeAt,
  replaceAt,
} from './plan-draft.ts'
import { useEntryTarget, useTargetsById } from './use-entry-target.ts'
import { useLoads } from './use-loads.ts'

/**
 * One entry's settings, opened from its line in the outline (#26): what it asks — the fields — and
 * what is done to it whole: up or down its day, to another day, or out of the plan — asked twice.
 * A sheet on a phone, a panel beside the outline on a desktop; each change is the whole plan, saved
 * as made. The page keeps it open by the entry's key, so it follows the entry where it moves —
 * and keys it by that too: it remembers the entry as opened, to say when an edit restarts the
 * viewer's target from the plan.
 */
export function EntrySettings({
  workoutId,
  canEdit,
  days,
  at,
  exercise,
  onChange,
}: {
  readonly workoutId: string
  /** False for a reader: the plan said, not edited — their own target still theirs to change. */
  readonly canEdit: boolean
  readonly days: readonly DayDraft[]
  readonly at: EntryAt
  readonly exercise: Exercise
  readonly onChange: (days: readonly DayDraft[]) => void
}): React.JSX.Element | null {
  const day = days[at.day]
  const entry = day?.entries[at.entry]
  // The viewer's own target on it, once read; none for an entry not saved yet.
  const targets = useTargetsById(workoutId)
  if (day === undefined || entry === undefined) return null
  const suggestion = entry.id === undefined ? undefined : targets.get(entry.id)
  return (
    <Placed
      workoutId={workoutId}
      canEdit={canEdit}
      days={days}
      at={at}
      day={day}
      entry={entry}
      exercise={exercise}
      suggestion={suggestion}
      onChange={onChange}
    />
  )
}

/** The entry, found where it is: its fields, and where it is in the plan. */
function Placed({
  workoutId,
  canEdit,
  days,
  at,
  day,
  entry,
  exercise,
  suggestion,
  onChange,
}: {
  readonly workoutId: string
  readonly canEdit: boolean
  readonly days: readonly DayDraft[]
  readonly at: EntryAt
  readonly day: DayDraft
  readonly entry: EntryDraft
  readonly exercise: Exercise
  readonly suggestion: ProgressionSuggestion | undefined
  readonly onChange: (days: readonly DayDraft[]) => void
}): React.JSX.Element {
  // What a new weight rule adds: a step of the athlete's equipment for it, when known (#36).
  const load = useLoads()(exercise)
  const own = useEntryTarget(workoutId, entry, suggestion)
  const id = `plan-entry-${String(at.day)}-${String(at.entry)}`
  // Where the logger counts its rest: a superset's earlier entry rests only when done alone (#48).
  const rest = restPlace(day.entries, at.entry)
  const withEntries = (entries: DayDraft['entries']) => replaceAt(days, at.day, { ...day, entries })
  const move = (to: number) => () => {
    onChange(withEntries(moveItem(day.entries, at.entry, to)))
  }

  if (!canEdit) {
    return (
      <EntryRead
        entry={entry}
        rest={rest}
        tracking={exercise.tracking}
        target={own.target}
        change={own.change}
        testID={id}
      />
    )
  }
  return (
    <Stack gap="xxl">
      <EntryEditor
        entry={entry}
        rest={rest}
        tracking={exercise.tracking}
        load={load}
        onChange={(next) => {
          onChange(withEntries(replaceAt(day.entries, at.entry, next)))
        }}
        target={own.target}
        change={own.change}
        restartedFrom={own.restartedFrom}
        testID={id}
      />
      <Stack gap="sm">
        <Text variant="heading">In the plan</Text>
        {days.length > 1 ? (
          <Choice
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
