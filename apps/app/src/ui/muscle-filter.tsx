import { useState } from 'react'
import { MUSCLES, MUSCLE_REGIONS, MUSCLE_REGION_LABELS, type MuscleSlug } from '@cedo/contract'
import { Button } from './button.tsx'
import { Chips } from './chips.tsx'
import { Sheet } from './sheet.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

const ANY = 'any'

/**
 * Narrowing a list of exercises to those loading one muscle (#27): one button saying which — or Any
 * muscle — that opens the muscles grouped by region, upper body, core, lower body, as a lifter
 * thinks of them rather than one wall of thirty-four.
 */
export function MuscleFilter({
  value,
  onChange,
  testID,
}: {
  readonly value: MuscleSlug | null
  readonly onChange: (muscle: MuscleSlug | null) => void
  readonly testID: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const name = MUSCLES.find((m) => m.slug === value)?.name
  const choose = (chosen: string) => {
    onChange(chosen === ANY ? null : (MUSCLES.find((m) => m.slug === chosen)?.slug ?? null))
    setOpen(false)
  }
  return (
    <>
      <Button
        title={name ?? 'Any muscle'}
        variant="secondary"
        size="small"
        onPress={() => {
          setOpen(true)
        }}
        testID={testID}
      />
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false)
        }}
        title="Muscle"
        testID={`${testID}-sheet`}
      >
        <Chips
          options={[{ value: ANY, label: 'Any muscle' }]}
          value={value ?? ANY}
          onChange={choose}
          testID={`${testID}-any`}
        />
        {MUSCLE_REGIONS.map((region) => (
          <Stack key={region} gap="sm">
            <Text variant="label" tone="muted">
              {MUSCLE_REGION_LABELS[region]}
            </Text>
            <Chips
              options={MUSCLES.filter((m) => m.region === region).map((m) => ({
                value: m.slug,
                label: m.name,
              }))}
              value={value ?? ANY}
              onChange={choose}
              testID={`${testID}-${region}`}
            />
          </Stack>
        ))}
      </Sheet>
    </>
  )
}
