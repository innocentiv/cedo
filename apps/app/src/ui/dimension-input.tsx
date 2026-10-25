import { useState } from 'react'
import { type Dimension, type TrackingMode, assistable, assistance, fieldFor } from '@cedo/contract'
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
  readonly size?: 'regular' | 'large' | undefined
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
  size,
  testID,
}: DimensionInputProps): React.JSX.Element {
  // Weight in the person's own unit; every other dimension is the same for everyone.
  const field = fieldFor(dimension, useWeightUnit())
  const canAssist = tracking !== undefined && assistable(dimension, tracking)
  /**
   * Assistance is NEGATIVE added weight (#19), and a minus sign cannot be typed on a phone's number
   * pad — so the number typed is the size, and the toggle its sign. The rules are the contract's
   * (`assistance`); this keeps only the last sign seen, for a field emptied on the way to retyping.
   */
  const [remembered, setRemembered] = useState(() => assistance.remembered(value, false))
  const assisted = canAssist && assistance.of(value, remembered)
  const change = (next: number | null) => {
    setRemembered(assistance.remembered(next, assisted))
    onChange(next)
  }
  return (
    <CompactField label={label ?? field.unit(tracking, assisted)}>
      <TypedNumber
        value={canAssist ? assistance.shown(value) : value}
        onChange={(typed) => {
          change(canAssist ? assistance.stored(typed, assisted) : typed)
        }}
        typing={field}
        size={size}
        testID={testID}
      />
      {canAssist ? (
        <Chips
          options={ASSISTANCE}
          value={assisted ? 'assisted' : 'added'}
          onChange={(chosen) => {
            const toAssisted = chosen === 'assisted'
            setRemembered(toAssisted)
            onChange(assistance.turned(value, toAssisted))
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
