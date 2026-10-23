import { useState } from 'react'
import { type Dimension, type TrackingMode, assistable, fieldFor } from '@cedo/contract'
import { useWeightUnit } from '../lib/weight-unit.ts'
import { type ChipOption, Chips } from './chips.tsx'
import { CompactField, TypedNumber } from './input.tsx'

export interface DimensionInputProps {
  readonly dimension: Dimension
  /** Only weight reads it: on a bodyweight movement the field is weight ADDED, `+kg`. */
  readonly tracking?: TrackingMode | undefined
  /** In base units — grams, millimetres, seconds — as stored everywhere. Null means empty. */
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  /** Defaults to the dimension's unit. A progression increment says "Add kg". */
  readonly label?: string | undefined
  readonly testID?: string | undefined
}

/**
 * One measured quantity, typed in its display unit and handed back in base units. The unit, the
 * label, the decimals and the conversion are all the contract's (`fieldFor`): the logger, the
 * plan editor and the progression field used to decide them each for themselves, and disagreed.
 */
export function DimensionInput({
  dimension,
  tracking,
  value,
  onChange,
  label,
  testID,
}: DimensionInputProps): React.JSX.Element {
  // Weight in the person's own unit; every other dimension is the same for everyone.
  const field = fieldFor(dimension, useWeightUnit())
  const canAssist = tracking !== undefined && assistable(dimension, tracking)
  /**
   * Assistance is NEGATIVE added weight (#19), and a minus sign cannot be typed on a phone's number
   * pad — so the number typed is always the size, and this says which way it goes. A stored value
   * carries its own sign: an assisted target opens assisted. Only an empty field, or a zero, has
   * no sign to read, so it keeps the choice here until a number is typed.
   */
  const [assistedWhenUnsigned, setAssistedWhenUnsigned] = useState(false)
  const assisted = canAssist && (value === null || value === 0 ? assistedWhenUnsigned : value < 0)
  return (
    <CompactField label={label ?? field.unit(tracking, assisted)}>
      <TypedNumber
        value={assisted && value !== null ? -value : value}
        onChange={(typed) => {
          onChange(typed === null || !assisted ? typed : -typed)
        }}
        typing={field}
        testID={testID}
      />
      {canAssist ? (
        <Chips
          options={ASSISTANCE}
          value={assisted ? 'assisted' : 'added'}
          onChange={(chosen) => {
            const toAssisted = chosen === 'assisted'
            setAssistedWhenUnsigned(toAssisted)
            // A typed number keeps its size and turns round: 20 added becomes 20 of assistance.
            if (value !== null && value !== 0 && toAssisted !== value < 0) onChange(-value)
          }}
          testID={`${testID ?? 'weight'}-assistance`}
        />
      ) : null}
    </CompactField>
  )
}

const ASSISTANCE: readonly ChipOption<'added' | 'assisted'>[] = [
  { value: 'added', label: 'Added' },
  { value: 'assisted', label: 'Assisted' },
]
