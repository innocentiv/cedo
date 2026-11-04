import { useState } from 'react'
import {
  type Effort,
  type SetLog,
  type SetLogUpdate,
  asksReserve,
  fieldsOf,
  startingEffort,
} from '@cedo/contract'
import { useCorrectSet, useRemoveSet } from '../api/session-queries.ts'
import {
  Button,
  Card,
  Choice,
  ConfirmButton,
  FormError,
  ReserveSegments,
  Stack,
  Stepper,
} from '../ui/index.ts'
import { useSubmit } from './use-submit.ts'

/**
 * A set fixed (#31), right below its row in the session's list (#63) — in progress or finished
 * alike, one way everywhere: its numbers on the logger's own steppers, how hard it was, whether a
 * warm-up — and Save, or Remove, asked twice. Never over the set being logged or its rest: fixing
 * one set is apart from what is done next. Never its exercise: a set of another one is removed here
 * and logged again. A set of an exercise out of reach has no measures to show, so only how hard and
 * whether a warm-up are offered. Keyed by the set, so the numbers start again from each set opened.
 */
export function FixSet({
  sessionId,
  log,
  onDone,
}: {
  readonly sessionId: string
  readonly log: SetLog
  /** Saved, or removed: the row closes. */
  readonly onDone: () => void
}): React.JSX.Element {
  return (
    <Card testID="fix-set">
      <FixSetForm key={log.id} sessionId={sessionId} log={log} onDone={onDone} />
    </Card>
  )
}

const KINDS = [
  { value: 'working', label: 'Working set' },
  { value: 'warmup', label: 'Warm-up' },
] as const

function FixSetForm({
  sessionId,
  log,
  onDone,
}: {
  readonly sessionId: string
  readonly log: SetLog
  readonly onDone: () => void
}): React.JSX.Element {
  const tracking = log.exercise?.tracking ?? null
  // In base units throughout, as the logger's: the fields convert for display.
  // As the logger's: on a bodyweight movement, no weight added reads 0 (`startingEffort`).
  const [effort, setEffort] = useState<Effort>(() =>
    tracking === null ? log : startingEffort(log, tracking),
  )
  const [reserve, setReserve] = useState(log.reserve)
  const [isWarmup, setIsWarmup] = useState(log.isWarmup)
  const correct = useCorrectSet(sessionId)
  const remove = useRemoveSet(sessionId)
  const saving = useSubmit()
  const removing = useSubmit()

  // What is shown is what is sent; a set out of reach shows, and sends, no measures.
  const patch: SetLogUpdate = { ...(tracking === null ? {} : effort), reserve, isWarmup }
  return (
    <Stack gap="lg">
      {tracking === null
        ? null
        : fieldsOf(tracking).map((field) => (
            <Stepper
              key={field.dimension}
              dimension={field.dimension}
              tracking={tracking}
              value={effort[field.key]}
              onChange={(value) => {
                setEffort((current) => ({ ...current, [field.key]: value }))
              }}
              testID={`fix-set-${field.dimension}`}
            />
          ))}
      {/* Out of reach, there is no saying it has no reps: how hard is offered, as it was logged. */}
      {tracking !== null && !asksReserve(tracking) ? null : (
        <ReserveSegments
          label="In reserve"
          reserve={reserve}
          onChange={setReserve}
          testID="fix-set-reserve"
        />
      )}
      <Choice
        options={KINDS}
        value={isWarmup ? 'warmup' : 'working'}
        onChange={(kind) => {
          setIsWarmup(kind === 'warmup')
        }}
        testID="fix-set-kind"
      />
      <Stack gap="sm">
        <Button
          title="Save"
          busy={saving.busy}
          onPress={() => {
            void saving.submit(async () => {
              await correct.mutateAsync({ logId: log.id, patch })
              onDone()
            })
          }}
          testID="fix-set-save"
        />
        <FormError message={saving.error} testID="fix-set-error" />
        <ConfirmButton
          title="Remove set"
          busy={removing.busy}
          error={removing.error}
          onConfirm={async () => {
            await removing.submit(async () => {
              await remove.mutateAsync(log.id)
              onDone()
            })
          }}
          testID="fix-set-remove"
        />
      </Stack>
    </Stack>
  )
}
