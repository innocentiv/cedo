import { useState } from 'react'
import {
  type Load,
  type RuleSettingName,
  type TrackingMode,
  formatWeight,
  progressionOf,
  ruleLabel,
  ruleSentence,
  ruleSettings,
  rulesFor,
  switchRule,
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
      <Settings load={load} entry={entry} onEntry={onChange} testID={testID} />
      <Help testID={`${testID}-progression-summary`}>
        {ruleSentence(rule, (g) => formatWeight(g, unit))}
      </Help>
    </Stack>
  )
}

/** Each setting's input, as the plan's journeys find it. */
const SETTING_IDS: Readonly<Record<RuleSettingName, string>> = {
  from: 'rep-min',
  to: 'rep-max',
  increase: 'increment',
  after: 'after',
}

/** The rule's own numbers, as the contract says them (`ruleSettings`), each in its own input. */
function Settings({
  load,
  entry,
  onEntry,
  testID,
}: {
  readonly load: Load | null
  readonly entry: EntryDraft
  readonly onEntry: (entry: EntryDraft) => void
  readonly testID: string
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  const settings = ruleSettings(entry, unit, load)
  if (settings.length === 0) return null
  return (
    <Stack direction="row" gap="sm" wrap>
      {settings.map((setting) => {
        const id = `${testID}-${SETTING_IDS[setting.name]}`
        const onChange = (value: number | null) => {
          onEntry(setting.change(value))
        }
        return setting.input === 'count' ? (
          <CompactField key={setting.name} label={setting.label}>
            <NumberInput value={setting.value} onChange={onChange} testID={id} />
          </CompactField>
        ) : (
          <DimensionInput
            key={setting.name}
            dimension={setting.input}
            label={setting.label}
            value={setting.value}
            onChange={onChange}
            testID={id}
          />
        )
      })}
    </Stack>
  )
}
