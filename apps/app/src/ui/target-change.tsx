import { useState } from 'react'
import {
  DIMENSION_FIELDS,
  type Dimension,
  type Progression,
  type SetTarget,
  type TargetByHand,
  type TrackingMode,
  formatEffort,
  settableByHand,
  startAtChoices,
} from '@cedo/contract'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { Button } from './button.tsx'
import { Choice } from './choice.tsx'
import { DimensionInput } from './dimension-input.tsx'
import { Help, Label } from './entry-section.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/** Setting the viewer's own target by hand, as the editor's screen wires it to the server. */
export interface ChangeTarget {
  readonly busy: boolean
  readonly error: string | null
  /** Sets it; `done` once it is set, to close the form. A refusal stays, said in `error`. */
  readonly set: (input: TargetByHand, done: () => void) => void
}

/**
 * The viewer's next session (ADR-0026): their own target, read only, with **Change** — which offers
 * only what the rule moves (`settableByHand`): a double's reps, inside its range, and weight;
 * linear's weight; a hold's seconds; a run's distance, its time following. A target is its person's,
 * not the plan's, so a reader of the plan can change their own.
 */
export function NextSession({
  rule,
  tracking,
  target,
  change,
  testID,
}: {
  readonly rule: Progression
  readonly tracking: TrackingMode
  /** Null until it is read, and for an entry not saved yet. */
  readonly target: SetTarget | null
  readonly change: ChangeTarget | null
  readonly testID: string
}): React.JSX.Element {
  const unit = useWeightUnit()
  const [draft, setDraft] = useState<TargetByHand | null>(null)
  if (target === null) {
    return <Help>Saved, it starts from the plan.</Help>
  }
  return (
    <Stack gap="sm">
      <Text variant="mono" testID={`${testID}-next`}>
        {formatEffort(target, tracking, unit)}
      </Text>
      {change === null ? null : draft === null ? (
        <Button
          title="Change"
          variant="secondary"
          size="small"
          onPress={() => {
            setDraft({})
          }}
          testID={`${testID}-change`}
        />
      ) : (
        <ChangeForm
          rule={rule}
          tracking={tracking}
          target={target}
          draft={draft}
          onDraft={setDraft}
          change={change}
          onClose={() => {
            setDraft(null)
          }}
          testID={`${testID}-change`}
        />
      )}
    </Stack>
  )
}

function ChangeForm({
  rule,
  tracking,
  target,
  draft,
  onDraft,
  change,
  onClose,
  testID,
}: {
  readonly rule: Progression
  readonly tracking: TrackingMode
  readonly target: SetTarget
  readonly draft: TargetByHand
  readonly onDraft: (draft: TargetByHand) => void
  readonly change: ChangeTarget
  readonly onClose: () => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack gap="sm" testID={testID}>
      {settableByHand(rule).map((dimension) =>
        dimension === 'reps' && rule.kind === 'double' ? (
          <Stack key={dimension} gap="xs">
            <Label>Reps</Label>
            <Choice
              options={startAtChoices(rule).map((n) => ({ value: String(n), label: String(n) }))}
              value={String(draft.reps ?? target.reps ?? '')}
              onChange={(n) => {
                onDraft({ ...draft, reps: Number(n) })
              }}
              numeric
              testID={`${testID}-reps`}
            />
          </Stack>
        ) : (
          <DimensionInput
            key={dimension}
            dimension={dimensionOf(dimension)}
            tracking={tracking}
            value={draft[dimension] ?? target[dimension]}
            onChange={(value) => {
              onDraft(value === null ? draft : { ...draft, [dimension]: value })
            }}
            testID={`${testID}-${dimensionOf(dimension)}`}
          />
        ),
      )}
      {change.error === null ? null : (
        <Text variant="caption" tone="danger" testID={`${testID}-error`}>
          {change.error}
        </Text>
      )}
      <Stack direction="row" gap="sm">
        <Button
          title="Set"
          size="small"
          busy={change.busy}
          onPress={() => {
            change.set(draft, onClose)
          }}
          testID={`${testID}-save`}
        />
        <Button
          title="Cancel"
          variant="secondary"
          size="small"
          onPress={onClose}
          testID={`${testID}-cancel`}
        />
      </Stack>
    </Stack>
  )
}

/** A dimension Change may set, as `DimensionInput` names it: the contract's field for that key. */
const dimensionOf = (key: keyof TargetByHand): Dimension =>
  Object.values(DIMENSION_FIELDS).find((field) => field.key === key)?.dimension ?? 'reps'
