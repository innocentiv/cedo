import { useState } from 'react'
import {
  type Effort,
  type SetLog,
  type SetLogUpdate,
  asksReserve,
  fieldsOf,
  loggedTitle,
} from '@cedo/contract'
import { useCorrectSet, useRemoveSet } from '../api/session-queries.ts'
import {
  Button,
  Chips,
  ConfirmButton,
  FormError,
  ReserveChips,
  Sheet,
  Stack,
  Stepper,
} from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { useSubmit } from './use-submit.ts'

/**
 * A past mistake fixed (#31): a set of a finished session, opened from its summary — its numbers on
 * the logger's own steppers, how hard it was, whether a warm-up — and Save, or Remove, asked twice.
 * Never its exercise: a set of another one is removed here and logged again. A set of an exercise
 * out of reach has no measures to show, so only how hard and whether a warm-up are offered.
 */
export function FixSet({
  sessionId,
  log,
  logs,
  onClose,
}: {
  readonly sessionId: string
  /** The set open, or none: the sheet is put away. */
  readonly log: SetLog | null
  /** Every set of the session, which says what this one is called — "Set 2", "Warm-up 1". */
  readonly logs: readonly SetLog[]
  readonly onClose: () => void
}): React.JSX.Element {
  return (
    <Sheet
      open={log !== null}
      onClose={onClose}
      title={log === null ? '' : `${exerciseName(log.exercise)} · ${loggedTitle(log, logs)}`}
      testID="fix-set"
    >
      {/* Keyed by the set, so the numbers start again from each set opened. */}
      {log === null ? null : (
        <FixSetForm key={log.id} sessionId={sessionId} log={log} onDone={onClose} />
      )}
    </Sheet>
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
  const [effort, setEffort] = useState<Effort>({
    weightG: log.weightG,
    reps: log.reps,
    durationS: log.durationS,
    distanceMm: log.distanceMm,
  })
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
        <ReserveChips
          label="In reserve"
          reserve={reserve}
          onChange={setReserve}
          testID="fix-set-reserve"
        />
      )}
      <Chips
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
