import {
  type SessionDetail,
  formatDay,
  formatDuration,
  formatEffort,
  notesToKeep,
  personalBestsLabel,
  sessionSummary,
} from '@cedo/contract'
import { useState } from 'react'
import { Card, Field, Input, Stack, Text } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * What a finished session came to (#24): how long it took, its working sets, and its personal
 * bests by name — shown once it is finished, and whenever it is opened again from history (#25). Its
 * notes are written beside it, its sets by exercise. The numbers are the contract's
 * `sessionSummary`.
 */
export function FinishedSummary({
  session,
}: {
  readonly session: SessionDetail
}): React.JSX.Element {
  const unit = useWeightUnit()
  const summary = sessionSummary(session)
  return (
    <Card testID="session-finished">
      <Stack gap="md">
        <Text variant="label" tone="muted">
          {formatDay(new Date(session.startedAt))}
        </Text>
        <Stack direction="row" gap="xl">
          <Stack gap="xs">
            <Text variant="caption" tone="muted">
              Time
            </Text>
            <Text variant="number" testID="session-finished-time">
              {summary.durationS === null ? '—' : formatDuration(summary.durationS)}
            </Text>
          </Stack>
          <Stack gap="xs">
            <Text variant="caption" tone="muted">
              Working sets
            </Text>
            <Text variant="number" testID="session-finished-sets">
              {String(summary.workingSets)}
            </Text>
          </Stack>
        </Stack>
        {summary.personalBests.length === 0 ? null : (
          <Stack gap="xs" testID="session-finished-bests">
            <Text variant="label" tone="best">
              {personalBestsLabel(summary.personalBests.length)}
            </Text>
            {summary.personalBests.map((log) => (
              <Text key={log.id}>
                {`${exerciseName(log.exercise)} · ${formatEffort(log, log.exercise?.tracking ?? null, unit)}`}
              </Text>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

/**
 * A finished session's notes, written where they are read (#25): a journal of how it went, kept as
 * the field is left — no Save, as in the session's menu while it runs.
 */
export function SessionNotes({
  notes,
  onSave,
}: {
  readonly notes: string | null
  readonly onSave: (notes: string | null) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState(notes ?? '')
  return (
    <Field label="Notes">
      <Input
        value={draft}
        onChangeText={setDraft}
        placeholder="How it went, what to change"
        multiline
        onBlur={() => {
          const kept = notesToKeep(draft, notes)
          if (kept !== undefined) void onSave(kept)
        }}
        testID="session-notes"
      />
    </Field>
  )
}
