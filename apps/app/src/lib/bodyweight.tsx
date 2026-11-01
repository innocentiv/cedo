import { useState } from 'react'
import {
  type WeighIn,
  bodyweightTrend,
  calendarDayOf,
  trendParts,
  weighInRow,
} from '@cedo/contract'
import {
  Button,
  Card,
  ConfirmButton,
  DimensionInput,
  FormError,
  Loaded,
  Stack,
  Text,
} from '../ui/index.ts'
import { useBodyweight, useRemoveWeighIn, useWeighIn } from '../api/weigh-in-queries.ts'
import { useAuth } from '../auth/auth-provider.tsx'
import { useSubmit } from './use-submit.ts'
import { useWeightUnit } from './weight-unit.ts'

/** Past weigh-ins shown before "Show all": a week's, weighed daily. */
const SHOWN = 7

/**
 * Bodyweight (#42): the latest weigh-in and its change over the period, today's taken, and the
 * period's below — yours on Progress, or an athlete's on their page, taken by either. Every word
 * and number is the contract's (`weigh-in.ts`). See GLOSSARY.md, "Weigh-in".
 */
export function BodyweightCard({
  athleteId,
  weeks,
  testID,
}: {
  /** Whose: an athlete you coach — or, left out, you. */
  readonly athleteId?: string
  readonly weeks: number
  readonly testID: string
}): React.JSX.Element {
  const unit = useWeightUnit()
  return (
    <Card testID={testID}>
      <Stack gap="md">
        <Text variant="label" tone="muted">
          Bodyweight
        </Text>
        <Loaded query={useBodyweight(athleteId, weeks)} testID={`${testID}-read`}>
          {(bodyweight) => {
            const trend = bodyweightTrend(bodyweight)
            const parts = trend === null ? null : trendParts(trend, unit)
            return (
              <Stack gap="md">
                {parts === null ? (
                  <Text tone="muted" testID={`${testID}-none`}>
                    No weigh-ins yet.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    <Text variant="number" testID={`${testID}-latest`}>
                      {parts.weight}
                    </Text>
                    <Text variant="caption" tone="muted" testID={`${testID}-change`}>
                      {parts.change === null ? parts.on : `${parts.on} · ${parts.change}`}
                    </Text>
                  </Stack>
                )}
                <Today athleteId={athleteId} testID={`${testID}-today`} />
                <Past weighIns={bodyweight.weighIns} athleteId={athleteId} testID={testID} />
              </Stack>
            )
          }}
        </Loaded>
      </Stack>
    </Card>
  )
}

/** Today's weight, typed in the reader's unit; taken again today, it replaces the one before. */
function Today({
  athleteId,
  testID,
}: {
  readonly athleteId: string | undefined
  readonly testID: string
}): React.JSX.Element {
  const [weightG, setWeightG] = useState<number | null>(null)
  const unit = useWeightUnit()
  const take = useWeighIn(athleteId)
  const { submit, busy, error } = useSubmit()
  return (
    <Stack gap="sm">
      <Stack direction="row" gap="sm" align="flex-end">
        <Stack grow>
          <DimensionInput
            dimension="weight"
            value={weightG}
            onChange={setWeightG}
            label={`Today, ${unit}`}
            testID={`${testID}-weight`}
          />
        </Stack>
        <Button
          title="Save"
          variant="secondary"
          disabled={weightG === null}
          busy={busy}
          onPress={() => {
            if (weightG === null) return
            void submit(async () => {
              await take.mutateAsync({ day: calendarDayOf(new Date()), weightG })
              setWeightG(null)
            })
          }}
          testID={`${testID}-save`}
        />
      </Stack>
      <FormError message={error} testID={`${testID}-error`} />
    </Stack>
  )
}

/** The period's weigh-ins, newest first — a week's, until all are asked for. */
function Past({
  weighIns,
  athleteId,
  testID,
}: {
  readonly weighIns: readonly WeighIn[]
  readonly athleteId: string | undefined
  readonly testID: string
}): React.JSX.Element | null {
  const [all, setAll] = useState(false)
  if (weighIns.length === 0) return null
  const shown = all ? weighIns : weighIns.slice(0, SHOWN)
  return (
    <Stack gap="sm" testID={`${testID}-list`}>
      {shown.map((weighIn, at) => (
        <PastWeighIn
          key={weighIn.id}
          weighIn={weighIn}
          athleteId={athleteId}
          testID={`${testID}-weigh-in-${String(at)}`}
        />
      ))}
      {shown.length < weighIns.length ? (
        <Button
          title={`Show all ${String(weighIns.length)}`}
          variant="ghost"
          size="small"
          onPress={() => {
            setAll(true)
          }}
          testID={`${testID}-all`}
        />
      ) : null}
    </Stack>
  )
}

/** One weigh-in: its day and weight, and who took it when that says something — and Remove. */
function PastWeighIn({
  weighIn,
  athleteId,
  testID,
}: {
  readonly weighIn: WeighIn
  readonly athleteId: string | undefined
  readonly testID: string
}): React.JSX.Element {
  const unit = useWeightUnit()
  const readerId = useAuth().me?.user.id ?? ''
  const remove = useRemoveWeighIn(athleteId)
  const { submit, busy, error } = useSubmit()
  return (
    <Stack direction="row" align="center" gap="sm" testID={testID}>
      <Stack grow>
        <Text testID={`${testID}-text`}>
          {weighInRow(weighIn, unit, { readerId, athleteId: athleteId ?? readerId })}
        </Text>
      </Stack>
      {weighIn.canDelete ? (
        <ConfirmButton
          title="Remove"
          size="small"
          busy={busy}
          error={error}
          onConfirm={async () => {
            await submit(async () => {
              await remove.mutateAsync(weighIn.id)
            })
          }}
          testID={`${testID}-remove`}
        />
      ) : null}
    </Stack>
  )
}
