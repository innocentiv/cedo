import {
  PROGRESSION_KINDS,
  type Progression,
  describeProgression,
  fieldFor,
  formatWeight,
} from '@cedo/contract'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { Chips } from './chips.tsx'
import { DimensionInput } from './dimension-input.tsx'
import { CompactField, NumberInput } from './input.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

const PROGRESSION_OPTIONS = PROGRESSION_KINDS.map((value) => ({
  value,
  label: { none: 'Manual', linear: 'Linear', double: 'Double', linear_duration: 'Duration' }[value],
}))

/**
 * Building a progression rule is the one place the editor touches a domain shape, so it does it by
 * constructing the contract's own discriminated union rather than a loose object.
 */
export function progressionOf(kind: Progression['kind'], previous: Progression): Progression {
  if (kind === previous.kind) return previous
  switch (kind) {
    case 'none':
      return { kind: 'none' }
    case 'linear':
      return { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }
    case 'double':
      return { kind: 'double', repRange: [8, 12], incrementG: 2500 }
    case 'linear_duration':
      return { kind: 'linear_duration', incrementS: 15, afterSuccesses: 1 }
  }
}

/**
 * The rule AND its settings, together.
 *
 * Showing only the four names made the control look inert — picking "Linear" changed nothing on
 * screen and never said by how much. The increment and the streak are the whole rule, and
 * `describeProgression` is the contract's own sentence for it, so the plan editor and the MCP tool
 * describe a rule identically.
 */
export function ProgressionField({
  rule,
  onChange,
  testID,
}: {
  readonly rule: Progression
  readonly onChange: (rule: Progression) => void
  readonly testID: string
}): React.JSX.Element {
  const unit = useWeightUnit()
  return (
    <Stack gap="xs">
      <Text variant="caption" tone="muted">
        Progression
      </Text>
      <Chips
        options={PROGRESSION_OPTIONS}
        value={rule.kind}
        onChange={(kind) => {
          onChange(progressionOf(kind, rule))
        }}
        testID={`${testID}-progression`}
      />

      <Stack direction="row" gap="sm">
        {rule.kind === 'linear' || rule.kind === 'double' ? (
          <DimensionInput
            dimension="weight"
            label={`Add ${fieldFor('weight', unit).unit()}`}
            value={rule.incrementG}
            onChange={(g) => {
              onChange({ ...rule, incrementG: g ?? 2500 })
            }}
            testID={`${testID}-increment`}
          />
        ) : null}
        {rule.kind === 'linear_duration' ? (
          <DimensionInput
            dimension="duration"
            label="Add time"
            value={rule.incrementS}
            onChange={(s) => {
              onChange({ ...rule, incrementS: s ?? 15 })
            }}
            testID={`${testID}-increment`}
          />
        ) : null}
        {rule.kind === 'linear' || rule.kind === 'linear_duration' ? (
          <CompactField label="after">
            <NumberInput
              value={rule.afterSuccesses}
              onChange={(n) => {
                onChange({ ...rule, afterSuccesses: n === null || n < 1 ? 1 : n })
              }}
              testID={`${testID}-after`}
            />
          </CompactField>
        ) : null}
        {rule.kind === 'double' ? (
          <>
            <CompactField label="from">
              <NumberInput
                value={rule.repRange[0]}
                onChange={(n) => {
                  onChange({ ...rule, repRange: [n ?? 1, rule.repRange[1]] })
                }}
                testID={`${testID}-rep-min`}
              />
            </CompactField>
            <CompactField label="to">
              <NumberInput
                value={rule.repRange[1]}
                onChange={(n) => {
                  onChange({ ...rule, repRange: [rule.repRange[0], n ?? 1] })
                }}
                testID={`${testID}-rep-max`}
              />
            </CompactField>
          </>
        ) : null}
      </Stack>

      <Text variant="caption" tone="faint" testID={`${testID}-progression-summary`}>
        {describeProgression(rule, (g) => formatWeight(g, unit))}
      </Text>
    </Stack>
  )
}
