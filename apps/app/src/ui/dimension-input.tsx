import { DIMENSION_FIELDS, type Dimension, type TrackingMode } from '@cedo/contract'
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
 * label, the decimals and the conversion are all the contract's `DIMENSION_FIELDS`: the logger, the
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
  const field = DIMENSION_FIELDS[dimension]
  return (
    <CompactField label={label ?? field.unit(tracking)}>
      <TypedNumber
        value={value}
        onChange={onChange}
        toText={field.toText}
        parse={field.parse}
        decimals={field.decimals}
        testID={testID}
      />
    </CompactField>
  )
}
