import {
  type Exercise,
  canAddDay,
  canAddEntry,
  describeProgression,
  formatPrescription,
  formatWeight,
  newDay,
  setTargetOf,
} from '@cedo/contract'
import { AddRow, IconButton, Input, ListRow, Stack, Text } from '../ui/index.ts'
import {
  type DayDraft,
  type EntryDraft,
  keyDay,
  moveItem,
  removeAt,
  replaceAt,
} from './plan-draft.ts'
import { useWeightUnit } from './weight-unit.ts'

/** Where an entry is in the plan: its day, and its place in that day. */
export interface EntryAt {
  readonly day: number
  readonly entry: number
}

/**
 * A workout's page is its outline (#26): days, and each entry one line — "Barbell Back Squat · 5 × 5
 * · 100 kg · Linear, +2.5 kg". A line opens the entry's settings; a day is renamed where its name
 * is, moved up or removed beside it, and given another exercise at its foot. Every change goes to
 * `onChange` whole, to be saved as made (ADR-0022). Read-only for a reader: the same outline, with
 * nothing to tap but Start. See docs/08-frontend.md, "Editing a workout".
 */
export function Outline({
  days,
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
  readonly canEdit: boolean
  readonly selected: EntryAt | null
  readonly onChange: (days: readonly DayDraft[]) => void
  readonly onSelect: (at: EntryAt) => void
  readonly onAddEntry: (day: number) => void
  /** Start, beside each day — absent while a session is in progress, or not yet known. */
  readonly start: ((dayIndex: number) => React.ReactNode) | null
}): React.JSX.Element {
  return (
    <Stack gap="xxl" testID="plan-outline">
      {days.map((day, d) => (
        <DayBlock
          key={day.key}
          day={day}
          index={d}
          library={library}
          canEdit={canEdit}
          selected={selected?.day === d ? selected.entry : null}
          onChange={(next) => {
            onChange(replaceAt(days, d, next))
          }}
          onMoveUp={
            d === 0
              ? undefined
              : () => {
                  onChange(moveItem(days, d, d - 1))
                }
          }
          onRemove={
            days.length === 1
              ? undefined
              : () => {
                  onChange(removeAt(days, d))
                }
          }
          onSelect={(entry) => {
            onSelect({ day: d, entry })
          }}
          onAddEntry={() => {
            onAddEntry(d)
          }}
          start={start?.(d) ?? null}
        />
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

/** One day: its name, what can be done to it, its entries one line each, and Add exercise. */
function DayBlock({
  day,
  index,
  library,
  canEdit,
  selected,
  onChange,
  onMoveUp,
  onRemove,
  onSelect,
  onAddEntry,
  start,
}: {
  readonly day: DayDraft
  readonly index: number
  readonly library: ReadonlyMap<string, Exercise>
  readonly canEdit: boolean
  readonly selected: number | null
  readonly onChange: (day: DayDraft) => void
  readonly onMoveUp: (() => void) | undefined
  readonly onRemove: (() => void) | undefined
  readonly onSelect: (entry: number) => void
  readonly onAddEntry: () => void
  readonly start: React.ReactNode
}): React.JSX.Element {
  return (
    <Stack gap="xs" testID={`plan-day-${index}`}>
      <Stack direction="row" align="center" gap="sm">
        <Stack grow>
          {canEdit ? (
            <Input
              value={day.name}
              onChangeText={(name) => {
                onChange({ ...day, name })
              }}
              autoCapitalize="sentences"
              look="heading"
              testID={`day-name-${index}`}
            />
          ) : (
            <Text variant="heading">{day.name}</Text>
          )}
        </Stack>
        {start}
        {canEdit && onMoveUp !== undefined ? (
          <IconButton
            name="up"
            label="Move the day up"
            onPress={onMoveUp}
            testID={`day-up-${index}`}
          />
        ) : null}
        {canEdit && onRemove !== undefined ? (
          <IconButton
            name="remove"
            label={`Remove ${day.name}`}
            edge="end"
            onPress={onRemove}
            testID={`day-remove-${index}`}
          />
        ) : null}
      </Stack>
      {day.entries.length === 0 ? (
        <Text tone="muted">No exercises yet.</Text>
      ) : (
        day.entries.map((entry, e) => (
          <EntryLine
            key={entry.key}
            entry={entry}
            exercise={library.get(entry.exerciseId)}
            current={selected === e}
            onPress={
              canEdit
                ? () => {
                    onSelect(e)
                  }
                : undefined
            }
            onRemove={() => {
              onChange({ ...day, entries: removeAt(day.entries, e) })
            }}
            testID={`plan-${index}-${e}`}
          />
        ))
      )}
      {canEdit && canAddEntry(day) ? (
        <AddRow title="Add exercise" onPress={onAddEntry} testID={`add-entry-${index}`} />
      ) : null}
    </Stack>
  )
}

/**
 * An entry as one line: its exercise — after its superset's letter — what it prescribes, and how it
 * progresses. An exercise out of the reader's reach has no settings to open: what it prescribes,
 * that it is unavailable, and the bin, which is the only way the plan saves again.
 */
function EntryLine({
  entry,
  exercise,
  current,
  onPress,
  onRemove,
  testID,
}: {
  readonly entry: EntryDraft
  readonly exercise: Exercise | undefined
  readonly current: boolean
  readonly onPress: (() => void) | undefined
  readonly onRemove: () => void
  readonly testID: string
}): React.JSX.Element {
  const unit = useWeightUnit()
  const sets = entry.sets.map((set) => ({ isWarmup: set.isWarmup, target: setTargetOf(set) }))
  const prescription = formatPrescription(sets, exercise?.tracking ?? null, unit)
  const id = testID.replace(/^plan-/u, 'plan-entry-')
  if (exercise === undefined) {
    return (
      <Stack direction="row" align="center" gap="sm" testID={id}>
        <Stack grow gap="xs">
          <Text variant="label" tone="muted" testID={`${id}-unavailable`}>
            Unavailable exercise — remove it to save
          </Text>
          <Text variant="caption" tone="muted" testID={`${id}-target`}>
            {prescription}
          </Text>
        </Stack>
        <IconButton
          name="remove"
          label="Remove the unavailable exercise"
          edge="end"
          onPress={onRemove}
          testID={`${id}-remove`}
        />
      </Stack>
    )
  }
  const rule =
    entry.progression.kind === 'none'
      ? null
      : describeProgression(entry.progression, (g) => formatWeight(g, unit))
  return (
    <ListRow
      title={`${entry.supersetGroup === null ? '' : `${entry.supersetGroup} · `}${exercise.name}`}
      subtitle={rule === null ? prescription : `${prescription} · ${rule}`}
      onPress={onPress}
      selected={current}
      testID={`plan-line-${testID.slice('plan-'.length)}`}
    />
  )
}
