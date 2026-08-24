import {
  PROGRESSION_KINDS,
  type Progression,
  describeProgression,
  formatWeight,
  gToKg,
  kgToG,
} from '@cedo/contract'
import { Chips } from './chips.tsx'
import { NumberInput } from './input.tsx'
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
          <Field label="Add kg">
            <NumberInput
              value={gToKg(rule.incrementG)}
              onChange={(kg) => {
                onChange({ ...rule, incrementG: kg === null ? 2500 : kgToG(kg) })
              }}
              decimals
              testID={`${testID}-increment`}
            />
          </Field>
        ) : null}
        {rule.kind === 'linear_duration' ? (
          <Field label="Add seconds">
            <NumberInput
              value={rule.incrementS}
              onChange={(s) => {
                onChange({ ...rule, incrementS: s ?? 15 })
              }}
              testID={`${testID}-increment`}
            />
          </Field>
        ) : null}
        {rule.kind === 'linear' || rule.kind === 'linear_duration' ? (
          <Field label="After">
            <NumberInput
              value={rule.afterSuccesses}
              onChange={(n) => {
                onChange({ ...rule, afterSuccesses: n === null || n < 1 ? 1 : n })
              }}
              testID={`${testID}-after`}
            />
          </Field>
        ) : null}
        {rule.kind === 'double' ? (
          <>
            <Field label="From">
              <NumberInput
                value={rule.repRange[0]}
                onChange={(n) => {
                  onChange({ ...rule, repRange: [n ?? 1, rule.repRange[1]] })
                }}
                testID={`${testID}-rep-min`}
              />
            </Field>
            <Field label="To">
              <NumberInput
                value={rule.repRange[1]}
                onChange={(n) => {
                  onChange({ ...rule, repRange: [rule.repRange[0], n ?? 1] })
                }}
                testID={`${testID}-rep-max`}
              />
            </Field>
          </>
        ) : null}
      </Stack>

      <Text variant="caption" tone="faint" testID={`${testID}-progression-summary`}>
        {describeProgression(rule, (g) => formatWeight(g))}
      </Text>
    </Stack>
  )
}

/** A labelled column, matching the one in `entry-editor.tsx`. */
function Field({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <Stack gap="xs" grow>
      <Text variant="caption" tone="faint">
        {label}
      </Text>
      {children}
    </Stack>
  )
}
