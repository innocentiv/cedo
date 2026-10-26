import { Loaded, Screen } from '../../../src/ui/index.ts'
import { useEquipment } from '../../../src/api/equipment-queries.ts'
import { EquipmentForm } from '../../../src/lib/equipment-setup.tsx'

/** Settings → Equipment (#34): what you have, as last said, to change and save whole. */
export default function Equipment(): React.JSX.Element {
  const equipment = useEquipment()
  return equipment.data === undefined ? (
    <Screen title="Your equipment" testID="equipment-screen">
      <Loaded query={equipment} testID="equipment">
        {() => null}
      </Loaded>
    </Screen>
  ) : (
    <EquipmentForm initial={equipment.data.items} />
  )
}
