import { useState } from 'react'
import { Card, type ChipOption, Chips, NavButton, Stack, Text } from '../ui/index.ts'
import { useEquipment } from '../api/equipment-queries.ts'

type Showing = 'doable' | 'all'

const SHOWING: readonly ChipOption<Showing>[] = [
  { value: 'doable', label: 'What I can do' },
  { value: 'all', label: 'Everything' },
]

/**
 * Doable (#35): a list of exercises offers what the caller's equipment lets them do, and a switch to
 * everything — once they have said what they have. Until then nothing is filtered, and there is no
 * switch: `described` false is where the screen asks them to say. The rule is the server's.
 */
export function useDoableFilter(testID: string): {
  readonly showAll: boolean
  readonly described: boolean | undefined
  readonly control: React.JSX.Element | null
} {
  const described = useEquipment().data?.described
  const [showing, setShowing] = useState<Showing>('doable')
  return {
    showAll: showing === 'all',
    described,
    control:
      described === true ? (
        <Chips options={SHOWING} value={showing} onChange={setShowing} testID={testID} />
      ) : null,
  }
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
