import {
  type TrackingMode,
  describeProgression,
  formatDuration,
  formatWeight,
  formatWithReserve,
  ruleSentence,
  setTargetOf,
} from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { Help, Label, Section } from './entry-section.tsx'
import type { EntryTargetView } from './sets-field.tsx'
import { Stack } from './stack.tsx'
import { type ChangeTarget, NextSession } from './target-change.tsx'
import { Text } from './text.tsx'

/**
 * An entry of a plan the viewer only reads (docs/08-frontend.md, "Editing a workout"): the same
 * sections, said rather than edited — but **Your next session** and **Change** are still theirs: a
 * target is its person's, not the plan's.
 */
export function EntryRead({
  entry,
  tracking,
  target,
  change,
  testID,
}: {
  readonly entry: EntryDraft
  readonly tracking: TrackingMode
  readonly target: EntryTargetView | null
  readonly change: ChangeTarget | null
  readonly testID: string
}): React.JSX.Element {
  const unit = useWeightUnit()
  const rule = entry.progression
  const kg = (g: number) => formatWeight(g, unit)
  let warmup = 0
  let working = 0
  const lines = entry.sets.map((set) => {
    const name = set.isWarmup ? `Warm-up ${String((warmup += 1))}` : `Set ${String((working += 1))}`
    return { name, said: formatWithReserve(setTargetOf(set), tracking, unit) }
  })
  return (
    <Stack gap="xxl" testID={testID}>
      <Section title="Progression">
        <Text testID={`${testID}-rule`}>{describeProgression(rule, kg)}</Text>
        <Help testID={`${testID}-progression-summary`}>{ruleSentence(rule, kg)}</Help>
      </Section>
      <Section title="Sets">
        <Stack gap="xs">
          {lines.map((line) => (
            <Stack key={line.name} direction="row" gap="sm">
              <Label>{line.name}</Label>
              <Text>{line.said}</Text>
            </Stack>
          ))}
        </Stack>
        {rule.kind === 'none' ? null : (
          <Stack gap="sm">
            <Label>Your next session</Label>
            <NextSession
              rule={rule}
              tracking={tracking}
              target={target?.suggested ?? null}
              change={change}
              testID={testID}
            />
          </Stack>
        )}
      </Section>
      <Section title="Rest & superset">
        <Text>
          {[
            entry.restSeconds === null ? 'No rest' : `Rest ${formatDuration(entry.restSeconds)}`,
            entry.supersetGroup === null ? null : `superset ${entry.supersetGroup}`,
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </Text>
      </Section>
      {entry.cue === null || entry.cue === '' ? null : (
        <Section title="Cue">
          <Text>{entry.cue}</Text>
        </Section>
      )}
    </Stack>
  )
}
