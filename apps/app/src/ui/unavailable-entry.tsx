import { formatEffort, prescriptionOf, setCounts, setTargetOf } from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

export interface UnavailableEntryProps {
  readonly entry: EntryDraft
  readonly exerciseName: string
  readonly onRemove: () => void
  readonly testID: string
}

/**
 * A plan entry whose exercise is unavailable: its prescription as measured, and the way out. The
 * plan cannot be saved while it is there — the server refuses an exercise its owner cannot see, and
 * `planIssues` says so in the footer — and with no mode nothing says what a target measures, so
 * none can be edited. It used to get weight-and-reps inputs, whatever it was. See GLOSSARY.md.
 */
export function UnavailableEntry({
  entry,
  exerciseName,
  onRemove,
  testID,
}: UnavailableEntryProps): React.JSX.Element {
  const unit = useWeightUnit()
  const first = prescriptionOf(entry)
  const { working } = setCounts(entry)
  const sets = `${working} set${working === 1 ? '' : 's'}`
  return (
    <Card testID={testID}>
      <Stack gap="sm">
        <Stack direction="row" gap="sm" align="center">
          <Stack grow>
            <Text variant="label">{exerciseName}</Text>
          </Stack>
          <Button title="Remove" variant="ghost" onPress={onRemove} testID={`${testID}-remove`} />
        </Stack>
        <Text variant="caption" tone="muted" testID={`${testID}-target`}>
          {first === undefined ? sets : `${sets} · ${formatEffort(setTargetOf(first), null, unit)}`}
        </Text>
        <Text variant="caption" tone="muted" testID={`${testID}-unavailable`}>
          Out of your reach: remove it to save the plan.
        </Text>
      </Stack>
    </Card>
  )
}
