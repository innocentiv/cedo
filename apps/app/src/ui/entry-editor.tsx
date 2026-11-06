import { type Load, type RestPlace, type TrackingMode, restNote } from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { Choice } from './choice.tsx'
import { DimensionInput } from './dimension-input.tsx'
import { Help, Label, Section } from './entry-section.tsx'
import { CompactField, Input } from './input.tsx'
import { RuleField } from './rule-field.tsx'
import { type EntryTargetView, SetsField } from './sets-field.tsx'
import { Stack } from './stack.tsx'
import type { ChangeTarget } from './target-change.tsx'

/** `-` is "performed alone". Four letters is more parallel work than anyone runs at once. */
const SUPERSET_OPTIONS = ['-', 'A', 'B', 'C', 'D'].map((value) => ({
  value,
  label: value === '-' ? 'None' : value,
}))

export interface EntryEditorProps {
  readonly entry: EntryDraft
  /** Where its rest falls in its day — see `restPlace`. */
  readonly rest: RestPlace
  /** Decides which target inputs exist, and which rules fit. A plank has no kilograms. */
  readonly tracking: TrackingMode
  /** What the athlete can load on its exercise, when their equipment says (#36). */
  readonly load: Load | null
  readonly onChange: (entry: EntryDraft) => void
  /** The viewer's own target on it — null until it is read, or for an entry not saved yet. */
  readonly own: EntryTargetView | null
  /** Setting their target by hand; null on Manual, which has none. */
  readonly change: ChangeTarget | null
  /** What their target was, while an edit restarts it from the plan. */
  readonly restartedFrom: string | null
  readonly testID: string
}

/**
 * Everything one entry of a plan asks (docs/08-frontend.md, "An entry's settings", ADR-0026), in
 * titled sections, in order — because what the rule is decides what every field below it means:
 * Progression, Sets, Rest & superset, Cue. Only the fields: the sheet or pane it opens in says which
 * exercise it is, and holds what is done to the entry whole — moving it, removing it.
 */
export function EntryEditor(props: EntryEditorProps): React.JSX.Element {
  const { entry, tracking, load, onChange, testID } = props
  // When an earlier superset entry's rest counts: only when it ends the round (#48).
  const note = restNote(entry.restSeconds, props.rest)
  return (
    <Stack gap="xxl" testID={testID}>
      <Section title="Progression">
        <RuleField
          entry={entry}
          tracking={tracking}
          load={load}
          onChange={onChange}
          testID={testID}
        />
      </Section>
      <Section title="Sets">
        <SetsField
          entry={entry}
          tracking={tracking}
          onChange={onChange}
          own={props.own}
          change={props.change}
          restartedFrom={props.restartedFrom}
          testID={testID}
        />
      </Section>
      <Section title="Rest & superset">
        <Stack direction="row" gap="sm">
          <DimensionInput
            dimension="duration"
            label="Rest"
            value={entry.restSeconds}
            onChange={(restSeconds) => {
              onChange({ ...entry, restSeconds })
            }}
            testID={`${testID}-rest`}
          />
        </Stack>
        {note === null ? null : <Help testID={`${testID}-rest-note`}>{note}</Help>}
        <Stack gap="xs">
          <Label>Superset</Label>
          <Choice
            options={SUPERSET_OPTIONS}
            value={entry.supersetGroup ?? '-'}
            onChange={(next) => {
              onChange({ ...entry, supersetGroup: next === '-' ? null : next })
            }}
            testID={`${testID}-superset`}
          />
          {entry.supersetGroup === null ? null : (
            <Help>{`Alternated with every other entry marked ${entry.supersetGroup} on this day.`}</Help>
          )}
        </Stack>
      </Section>
      <Section title="Cue">
        <CompactField label={null}>
          <Input
            value={entry.cue ?? ''}
            onChangeText={(cue) => {
              onChange({ ...entry, cue })
            }}
            placeholder="Pause 1 s at the chest"
            wraps
            testID={`${testID}-cue`}
          />
        </CompactField>
        <Help>One line for the athlete. Say effort in reps in reserve.</Help>
      </Section>
    </Stack>
  )
}
