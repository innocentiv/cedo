import { useState } from 'react'
import { Card, FilterSheet, NavButton, OptionRow, Stack, Text } from '../ui/index.ts'
import { useEquipment } from '../api/equipment-queries.ts'

export type Showing = 'doable' | 'all'

/** What each choice is called, and — in the sheet — what it lists. */
const SHOWING: readonly { value: Showing; label: string; detail: string }[] = [
  {
    value: 'doable',
    label: 'My Equipment',
    detail: 'Only what you can do with what you have',
  },
  { value: 'all', label: 'Any Equipment', detail: "Also what needs equipment you don't have" },
]

export interface DoableFilter {
  /** What the list query adds: everything, or nothing — the server keeps to what is doable. */
  readonly query: { readonly showAll?: true }
  /** Undefined while it is asked; false until the caller says what they train with. */
  readonly described: boolean | undefined
  readonly showing: Showing
  readonly setShowing: (showing: Showing) => void
}

/**
 * Doable (#35): a list of exercises offers what the caller's equipment lets them do, and everything
 * on asking — once they have said what they have. Until then nothing is filtered. The rule is the
 * server's; this holds which of the two the list asks for.
 */
export function useDoableFilter(): DoableFilter {
  const described = useEquipment().data?.described
  const [showing, setShowing] = useState<Showing>('doable')
  return {
    query: showing === 'all' ? { showAll: true } : {},
    described,
    showing,
    setShowing,
  }
}

/**
 * The switch between the two (#52) — My Equipment, or Any Equipment — shown once there is something
 * to switch: a described setup. Its sheet holds the two, each saying what it lists.
 */
export function EquipmentFilter({
  filter,
  testID,
}: {
  readonly filter: DoableFilter
  readonly testID: string
}): React.JSX.Element | null {
  if (filter.described !== true) return null
  return (
    <FilterSheet
      icon="equipment"
      label="Equipment"
      value={SHOWING.find((s) => s.value === filter.showing)?.label ?? ''}
      active={filter.showing !== 'doable'}
      testID={testID}
    >
      {(choose) => (
        <Stack gap="xs">
          {SHOWING.map((choice) => (
            <OptionRow
              key={choice.value}
              label={choice.label}
              detail={choice.detail}
              selected={filter.showing === choice.value}
              onPress={() => {
                choose(() => {
                  filter.setShowing(choice.value)
                })
              }}
              testID={`${testID}-${choice.value}`}
            />
          ))}
        </Stack>
      )}
    </FilterSheet>
  )
}

/** Until someone says what they train with: what saying it would do, and where. */
export function EquipmentPrompt(): React.JSX.Element {
  return (
    <Card testID="equipment-prompt">
      <Stack gap="sm">
        <Text>Tell cedo what you train with, and it offers only the exercises you can do.</Text>
        <NavButton
          title="Your equipment"
          href="/settings/equipment"
          variant="secondary"
          testID="describe-equipment"
        />
      </Stack>
    </Card>
  )
}
