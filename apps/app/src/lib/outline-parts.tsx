import { useState } from 'react'
import {
  type Exercise,
  describeProgression,
  formatPrescription,
  formatWeight,
  nameToKeep,
  setTargetOf,
} from '@cedo/contract'
import { IconButton, Input, ListRow, RemoveButton, Stack, Text } from '../ui/index.ts'
import type { EntryAt, EntryDraft } from './plan-draft.ts'
import { useWeightUnit } from './weight-unit.ts'

/** What can be done to a day as a whole, each absent where it cannot be. */
export interface DayMoves {
  readonly up: (() => void) | undefined
  readonly down: (() => void) | undefined
  readonly remove: (() => void) | undefined
}

/**
 * A day's name and what is done to it (#26): renamed where it reads — kept as the field is left, not
 * on every key, and put back if left empty, which no day may be called — Start, up, down, and the
 * bin, asked twice. A reader sees the name, and Start.
 */
export function DayHead({
  name,
  index,
  canEdit,
  onRename,
  moves,
  start,
}: {
  readonly name: string
  readonly index: number
  readonly canEdit: boolean
  readonly onRename: (name: string) => void
  readonly moves: DayMoves
  readonly start: React.ReactNode
}): React.JSX.Element {
  const [typed, setTyped] = useState(name)
  // A name read again — saved elsewhere, or put back after a refusal — replaces what was typed.
  const [shown, setShown] = useState(name)
  if (shown !== name) {
    setShown(name)
    setTyped(name)
  }
  const keep = () => {
    const kept = nameToKeep(typed, name)
    if (kept === undefined) setTyped(name)
    else onRename(kept)
  }
  return (
    <Stack direction="row" align="center" gap="sm">
      <Stack grow>
        {canEdit ? (
          <Input
            value={typed}
            onChangeText={setTyped}
            onBlur={keep}
            onSubmitEditing={keep}
            autoCapitalize="sentences"
            look="heading"
            testID={`day-name-${String(index)}`}
          />
        ) : (
          <Text variant="heading">{name}</Text>
        )}
      </Stack>
      {start}
      {canEdit && moves.up !== undefined ? (
        <IconButton
          name="up"
          label="Move the day up"
          onPress={moves.up}
          testID={`day-up-${String(index)}`}
        />
      ) : null}
      {canEdit && moves.down !== undefined ? (
        <IconButton
          name="down"
          label="Move the day down"
          onPress={moves.down}
          testID={`day-down-${String(index)}`}
        />
      ) : null}
      {canEdit && moves.remove !== undefined ? (
        <RemoveButton
          label={`Remove ${name}`}
          onRemove={moves.remove}
          testID={`day-remove-${String(index)}`}
        />
      ) : null}
    </Stack>
  )
}

/**
 * An entry as one line: its exercise — after its superset's letter — what it prescribes, and how it
 * progresses. An exercise out of the reader's reach has no settings to open: what it prescribes,
 * that it is unavailable, and the bin, which is the only way the plan saves again.
 */
export function EntryLine({
  entry,
  exercise,
  current,
  onPress,
  onRemove,
  at,
}: {
  readonly entry: EntryDraft
  readonly exercise: Exercise | undefined
  readonly current: boolean
  readonly onPress: (() => void) | undefined
  /** None for a reader: the plan is not theirs to change. */
  readonly onRemove: (() => void) | undefined
  readonly at: EntryAt
}): React.JSX.Element {
  const unit = useWeightUnit()
  const sets = entry.sets.map((set) => ({ isWarmup: set.isWarmup, target: setTargetOf(set) }))
  const prescription = formatPrescription(sets, exercise?.tracking ?? null, unit)
  const place = `${String(at.day)}-${String(at.entry)}`
  const id = `plan-entry-${place}`
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
        {onRemove === undefined ? null : (
          <RemoveButton
            label="Remove the unavailable exercise"
            onRemove={onRemove}
            testID={`${id}-remove`}
          />
        )}
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
      subtitle={[exercise.doable ? null : 'Missing equipment', prescription, rule]
        .filter((part) => part !== null)
        .join(' · ')}
      onPress={onPress}
      selected={current}
      testID={`plan-line-${place}`}
    />
  )
}
