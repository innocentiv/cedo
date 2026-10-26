import {
  EQUIPMENT_GROUPS,
  EQUIPMENT_GROUP_LABELS,
  type EquipmentSlug,
  NEEDABLE_EQUIPMENT,
  withEquipmentToggled,
} from '@cedo/contract'
import { Chip } from './chips.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

export interface EquipmentPickerProps {
  readonly value: readonly EquipmentSlug[] | null
  readonly onChange: (value: EquipmentSlug[] | null) => void
}

/**
 * What an exercise needs (#33): every item it cannot be done without, by group as the list keeps
 * them — or nothing at all. Nothing chosen is undescribed, which is not the same as needing
 * nothing, and the line above the choices says which it is.
 *
 * Which choices may go together is the contract's: one item holds the load at most, and the form
 * shows the refusal the API gives, as every form here does.
 */
export function EquipmentPicker({ value, onChange }: EquipmentPickerProps): React.JSX.Element {
  const toggle = (choice: EquipmentSlug | 'nothing') => () => {
    onChange(withEquipmentToggled(value, choice))
  }
  return (
    <Stack gap="sm" testID="equipment-picker">
      <Text variant="caption" tone="muted" testID="equipment-summary">
        {value === null
          ? 'Not described yet: offered to everyone, whatever they train with.'
          : value.length === 0
            ? 'Needs no equipment.'
            : 'Needs all of what is chosen.'}
      </Text>
      <Stack direction="row" gap="xs" wrap>
        <Chip
          label="No equipment"
          selected={value !== null && value.length === 0}
          onPress={toggle('nothing')}
          testID="equipment-option-nothing"
        />
      </Stack>
      {EQUIPMENT_GROUPS.map((group) => (
        <Stack key={group} gap="xs">
          <Text variant="caption" tone="muted">
            {EQUIPMENT_GROUP_LABELS[group]}
          </Text>
          <Stack direction="row" gap="xs" wrap>
            {NEEDABLE_EQUIPMENT.filter((item) => item.group === group).map((item) => (
              <Chip
                key={item.slug}
                label={item.name}
                selected={value?.includes(item.slug) ?? false}
                onPress={toggle(item.slug)}
                testID={`equipment-option-${item.slug}`}
              />
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  )
}
