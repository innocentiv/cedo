import { useState } from 'react'
import {
  DEFAULT_INCREMENT_MM,
  DEFAULT_INCREMENT_S,
  type Load,
  type Progression,
  type TrackingMode,
  fieldFor,
  formatWeight,
  newIncrementG,
  progressionOf,
  hasTarget,
  ruleLabel,
  ruleSentence,
  rulesFor,
  switchRule,
  withRange,
} from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { Button } from './button.tsx'
import { Choice } from './choice.tsx'
import { DimensionInput } from './dimension-input.tsx'
import { Help } from './entry-section.tsx'
import { CompactField, NumberInput } from './input.tsx'
import { Stack } from './stack.tsx'

/**
 * The Progression section (docs/08-frontend.md, "An entry's settings"): the mode — only the rules
 * that fit the exercise's tracking mode (`rulesFor`) — then the rule's settings, and one plain
 * sentence saying what it does (`ruleSentence`). Switching sets that differ — a top set and its
 * back-offs — to a rule asks first to use set 1's numbers for every set (`switchRule`).
 */
export function RuleField({
  entry,
  tracking,
  load,
  onChange,
  testID,
}: {
  readonly entry: EntryDraft
  readonly tracking: TrackingMode
  /** What the athlete can load on the exercise: a new weight rule adds one step of it (#36). */
  readonly load: Load | null
  readonly onChange: (entry: EntryDraft) => void
  readonly testID: string
}): React.JSX.Element {
  const unit = useWeightUnit()
  const rule = entry.progression
  // A switch that would overwrite a set's numbers, waiting to be asked.
  const [asking, setAsking] = useState<EntryDraft | null>(null)
  const setRule = (next: Progression) => {
    onChange({ ...entry, progression: next })
  }
  return (
    <Stack gap="md">
      <Choice
        options={rulesFor(tracking).map((kind) => ({ value: kind, label: ruleLabel(kind) }))}
        value={rule.kind}
        onChange={(kind) => {
          const switched = switchRule(entry, progressionOf(kind, rule, unit, load))
          if (switched.overwrites) setAsking(switched.entry)
          else onChange(switched.entry)
        }}
        testID={`${testID}-progression`}
      />
      {asking === null ? null : (
        <Stack gap="sm" testID={`${testID}-align`}>
          <Help>
            {`Under ${ruleLabel(asking.progression.kind)}, every working set asks the same. Use set 1’s numbers for every set? Each keeps its own reps in reserve.`}
          </Help>
          <Stack direction="row" gap="sm">
            <Button
              title="Use set 1’s"
              size="small"
              onPress={() => {
                onChange(asking)
                setAsking(null)
              }}
              testID={`${testID}-align-confirm`}
            />
            <Button
              title="Keep as it is"
              variant="secondary"
              size="small"
              onPress={() => {
                setAsking(null)
              }}
              testID={`${testID}-align-cancel`}
            />
          </Stack>
        </Stack>
      )}
      <Settings
        rule={rule}
        load={load}
        entry={entry}
        onRule={setRule}
        onEntry={onChange}
        testID={testID}
      />
      <Help testID={`${testID}-progression-summary`}>
        {ruleSentence(rule, (g) => formatWeight(g, unit))}
      </Help>
    </Stack>
  )
}

/** The rule's own numbers: a double's range and increase, a linear rule's increase and streak. */
function Settings({
  rule,
  load,
  entry,
  onRule,
  onEntry,
  testID,
}: {
  readonly rule: Progression
  readonly load: Load | null
  readonly entry: EntryDraft
  readonly onRule: (rule: Progression) => void
  readonly onEntry: (entry: EntryDraft) => void
  readonly testID: string
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  if (!hasTarget(rule)) return null
  return (
    <Stack direction="row" gap="sm" wrap>
      {rule.kind === 'double' ? (
        <>
          <CompactField label="From">
            <NumberInput
              value={rule.repRange[0]}
              onChange={(n) => {
                onEntry(withRange(entry, [n ?? 1, rule.repRange[1]]))
              }}
              testID={`${testID}-rep-min`}
            />
          </CompactField>
          <CompactField label="To">
            <NumberInput
              value={rule.repRange[1]}
              onChange={(n) => {
                onEntry(withRange(entry, [rule.repRange[0], n ?? 1]))
              }}
              testID={`${testID}-rep-max`}
            />
          </CompactField>
        </>
      ) : null}
      {rule.kind === 'linear' || rule.kind === 'double' ? (
        <DimensionInput
          dimension="weight"
          label={`Increase, ${fieldFor('weight', unit).unit()}`}
          value={rule.incrementG}
          onChange={(g) => {
            onRule({ ...rule, incrementG: g ?? newIncrementG(unit, load) })
          }}
          testID={`${testID}-increment`}
        />
      ) : null}
      {rule.kind === 'linear_duration' ? (
        <DimensionInput
          dimension="duration"
          label="Increase"
          value={rule.incrementS}
          onChange={(s) => {
            onRule({ ...rule, incrementS: s ?? DEFAULT_INCREMENT_S })
          }}
          testID={`${testID}-increment`}
        />
      ) : null}
      {rule.kind === 'linear_distance' ? (
        <DimensionInput
          dimension="distance"
          label="Increase, m"
          value={rule.incrementMm}
          onChange={(mm) => {
            onRule({ ...rule, incrementMm: mm ?? DEFAULT_INCREMENT_MM })
          }}
          testID={`${testID}-increment`}
        />
      ) : null}
      {'afterSuccesses' in rule ? (
        <CompactField label="After sessions">
          <NumberInput
            value={rule.afterSuccesses}
            onChange={(n) => {
              onRule({ ...rule, afterSuccesses: n === null || n < 1 ? 1 : n })
            }}
            testID={`${testID}-after`}
          />
        </CompactField>
      ) : null}
    </Stack>
  )
}
