import {
  type SetKind,
  type SetTarget,
  type TrackingMode,
  fieldsOf,
  hasTarget,
  prescribe,
  resizeSets,
  setCounts,
  startAtChoices,
} from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { Choice } from './choice.tsx'
import { DimensionInput } from './dimension-input.tsx'
import { Help, Label } from './entry-section.tsx'
import { CompactField, NumberInput } from './input.tsx'
import { ReserveRows } from './reserve-rows.tsx'
import { ManualLines, Warmups } from './set-lines.tsx'
import { Stack } from './stack.tsx'
import { type ChangeTarget, NextSession } from './target-change.tsx'

/** What the viewer's own target says of an entry — theirs, not the plan's (ADR-0026). */
export interface EntryTargetView {
  readonly suggested: SetTarget
  /** Each warm-up as their next session asks it, its weight following the target. */
  readonly warmups: readonly SetTarget[]
}

export interface SetsFieldProps {
  readonly entry: EntryDraft
  readonly tracking: TrackingMode
  readonly onChange: (entry: EntryDraft) => void
  readonly target: EntryTargetView | null
  readonly change: ChangeTarget | null
  /** "you were at 12 × 40 kg", while an edit restarts the target from the plan. */
  readonly restartedFrom: string | null
  readonly testID: string
}

/**
 * The Sets section (docs/08-frontend.md, "An entry's settings"): warm-ups and working sets counted,
 * warm-ups on lines of their own, then what the working sets ask — under a rule, **Plan** beside
 * **Your next session**, always; on Manual, a line per working set, as on paper.
 */
export function SetsField(props: SetsFieldProps): React.JSX.Element {
  const { entry, onChange, restartedFrom, testID } = props
  const counts = setCounts(entry)
  const resize = (band: SetKind) => (count: number | null) => {
    onChange(resizeSets(entry, band, count))
  }
  return (
    <Stack gap="lg">
      <Stack direction="row" gap="sm">
        <CompactField label="Warm-ups">
          <NumberInput
            value={counts.warmup}
            onChange={resize('warmup')}
            testID={`${testID}-warmups`}
          />
        </CompactField>
        <CompactField label="Working sets">
          <NumberInput
            value={counts.working}
            onChange={resize('working')}
            testID={`${testID}-sets`}
          />
        </CompactField>
      </Stack>
      <Warmups {...props} />
      {hasTarget(entry.progression) ? <Ruled {...props} /> : <ManualLines {...props} />}
      {restartedFrom === null ? null : (
        <Help testID={`${testID}-restarts`}>
          {`Your next session restarts from the plan (you were at ${restartedFrom}).`}
        </Help>
      )}
    </Stack>
  )
}

/** Under a rule: Plan, edited here, beside Your next session, read only with Change. */
function Ruled({
  entry,
  tracking,
  onChange,
  target,
  change,
  testID,
}: SetsFieldProps): React.JSX.Element {
  const plan = entry.sets.find((s) => !s.isWarmup)
  const choices = startAtChoices(entry.progression)
  return (
    <Stack gap="lg">
      <Stack direction="row" gap="lg">
        <Stack grow gap="sm">
          <Label>Plan</Label>
          {plan === undefined
            ? null
            : fieldsOf(tracking).map((field) =>
                field.dimension === 'reps' && choices.length > 0 ? (
                  <Stack key={field.dimension} gap="xs">
                    <Help>Start at</Help>
                    <Choice
                      options={choices.map((n) => ({ value: String(n), label: String(n) }))}
                      value={plan.targetReps === null ? null : String(plan.targetReps)}
                      onChange={(n) => {
                        onChange(prescribe(entry, { targetReps: Number(n) }))
                      }}
                      numeric
                      testID={`${testID}-reps`}
                    />
                  </Stack>
                ) : (
                  <DimensionInput
                    key={field.dimension}
                    dimension={field.dimension}
                    tracking={tracking}
                    value={plan[field.targetKey]}
                    onChange={(value) => {
                      // Only what changed, on every working set: their reserves stay their own.
                      onChange(prescribe(entry, { [field.targetKey]: value }))
                    }}
                    testID={`${testID}-${field.dimension}`}
                  />
                ),
              )}
        </Stack>
        <Stack grow gap="sm">
          <Label>Your next session</Label>
          <NextSession
            rule={entry.progression}
            tracking={tracking}
            target={target?.suggested ?? null}
            change={change}
            testID={testID}
          />
        </Stack>
      </Stack>
      <ReserveRows entry={entry} onChange={onChange} testID={testID} />
    </Stack>
  )
}
