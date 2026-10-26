import { equipmentName, ownedLines } from '@cedo/contract'
import { Card, Loaded, Stack, Text } from '../ui/index.ts'
import { useAthleteEquipment } from '../api/equipment-queries.ts'
import { useWeightUnit } from './weight-unit.ts'

/** What an athlete has to train with (#34), read by their coach to plan for their gym — only read. */
export function AthleteEquipmentCard({ id }: { readonly id: string }): React.JSX.Element {
  const unit = useWeightUnit()
  return (
    <Loaded query={useAthleteEquipment(id)} testID="athlete-equipment">
      {(equipment) => (
        <Card testID="athlete-equipment">
          <Stack gap="xs">
            <Text variant="label" tone="muted">
              Equipment
            </Text>
            {ownedLines(equipment, unit, {
              unsaid: 'Not described yet.',
              nothing: 'No equipment at all.',
              name: equipmentName,
            }).map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </Stack>
        </Card>
      )}
    </Loaded>
  )
}
