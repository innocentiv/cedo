import { MUSCLES, MUSCLE_REGIONS, MUSCLE_REGION_LABELS, type MuscleSlug } from '@cedo/contract'
import { FilterSheet } from './filters.tsx'
import { OptionGrid, OptionRow, OptionSection } from './options.tsx'
import { useLayout } from './use-layout.ts'

/**
 * Narrowing a list of exercises to those loading one muscle (#27, #52): All Muscles, or the one
 * chosen. Its sheet holds thirty-four, so it lays them out as a lifter thinks of them — upper body,
 * core, lower body — each a grid of cells of one width: two to a line on a phone, three on a
 * desktop. Choosing one closes it.
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
  const columns = useLayout() === 'tablet' ? 3 : 2
  return (
    <FilterSheet
      icon="muscle"
      label="Muscles"
      value={MUSCLES.find((m) => m.slug === value)?.name ?? 'All Muscles'}
      active={value !== null}
      testID={testID}
    >
      {(choose) => (
        <>
          <OptionRow
            label="All Muscles"
            selected={value === null}
            onPress={() => {
              choose(() => {
                onChange(null)
              })
            }}
            testID={`${testID}-any`}
          />
          {MUSCLE_REGIONS.map((region) => (
            <OptionSection key={region} title={MUSCLE_REGION_LABELS[region]}>
              <OptionGrid
                options={MUSCLES.filter((m) => m.region === region).map((m) => ({
                  value: m.slug,
                  label: m.name,
                }))}
                value={value}
                onChoose={(muscle) => {
                  choose(() => {
                    onChange(muscle)
                  })
                }}
                columns={columns}
                testID={testID}
              />
            </OptionSection>
          ))}
        </>
      )}
    </FilterSheet>
  )
}
