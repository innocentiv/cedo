import { useState } from 'react'
import {
  type DraftItem,
  EQUIPMENT,
  EQUIPMENT_GROUPS,
  EQUIPMENT_GROUP_LABELS,
  EQUIPMENT_SHORTCUTS,
  type EquipmentGroup,
  type TypedWeights,
  type EquipmentSlug,
  equipmentInputFrom,
  equipmentName,
  fieldFor,
  isWeighted,
  withItemToggled,
  unfinishedWeights,
  withShortcut,
} from '@cedo/contract'
import { Button, Chip, DimensionInput, FormError, Screen, Stack, Text } from '../ui/index.ts'
import { useSaveEquipment } from '../api/equipment-queries.ts'
import { useGoBack } from './use-go-back.ts'
import { useSubmit } from './use-submit.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * Settings → Equipment (#34): what you have to train with, ticked by group, and for what holds the
 * load how its weights go — from, step, to. Saved whole. What may be ticked together, and where a
 * ticked item's weights start, are the contract's (`withItemToggled`, `withShortcut`).
 */
export function EquipmentForm({
  initial,
}: {
  readonly initial: readonly DraftItem[]
}): React.JSX.Element {
  const unit = useWeightUnit()
  const goBack = useGoBack('/settings')
  const save = useSaveEquipment()
  const [items, setItems] = useState<readonly DraftItem[]>(initial)
  const { submit, busy, error } = useSubmit()
  // Asked of the draft before it is sent: half-typed weights would save as not known, silently.
  const [unfinished, setUnfinished] = useState<string | null>(null)
  const setWeights = (slug: DraftItem['slug'], weights: TypedWeights) => {
    setItems(items.map((i) => (i.slug === slug ? { slug, weights } : i)))
  }
  const onSave = () => {
    const half = unfinishedWeights(items)
    setUnfinished(
      half.length === 0
        ? null
        : `${half.map((slug) => equipmentName(slug)).join(', ')}: give a step and where it starts, or empty all three.`,
    )
    if (half.length > 0) return
    void submit(async () => {
      await save.mutateAsync(equipmentInputFrom(items))
      goBack()
    })
  }

  return (
    <Screen
      title="Your equipment"
      testID="equipment-screen"
      footer={<Button title="Save" busy={busy} onPress={onSave} testID="equipment-save" />}
    >
      <Text tone="muted">
        Tick what you train with. What holds the load says how its weights go, so the next set steps
        as your rack does.
      </Text>
      <Shortcuts
        onTick={(shortcut) => {
          setItems(withShortcut(items, shortcut, unit))
        }}
      />
      {EQUIPMENT_GROUPS.map((group) => (
        <Group
          key={group}
          group={group}
          items={items}
          onToggle={(slug) => {
            setItems(withItemToggled(items, slug, unit))
          }}
          onWeights={setWeights}
        />
      ))}
      {items.length === 0 ? (
        <Text tone="muted" testID="equipment-nothing">
          Nothing ticked: saved, you have no equipment at all, and only exercises that need none are
          offered.
        </Text>
      ) : null}
      <FormError message={unfinished ?? error} testID="equipment-error" />
    </Screen>
  )
}

/** Several items at once: a column, a bench, a whole gym. They only ever tick. */
function Shortcuts({
  onTick,
}: {
  readonly onTick: (items: readonly EquipmentSlug[]) => void
}): React.JSX.Element {
  return (
    <Stack direction="row" gap="xs" wrap>
      {EQUIPMENT_SHORTCUTS.map((shortcut, at) => (
        <Chip
          key={shortcut.name}
          label={`+ ${shortcut.name}`}
          selected={false}
          onPress={() => {
            onTick(shortcut.items)
          }}
          testID={`equipment-shortcut-${String(at)}`}
        />
      ))}
    </Stack>
  )
}

/** One group's items, and under them the weights of those ticked that hold the load. */
function Group({
  group,
  items,
  onToggle,
  onWeights,
}: {
  readonly group: EquipmentGroup
  readonly items: readonly DraftItem[]
  readonly onToggle: (slug: DraftItem['slug']) => void
  readonly onWeights: (slug: DraftItem['slug'], weights: TypedWeights) => void
}): React.JSX.Element {
  const inGroup = EQUIPMENT.filter((e) => e.group === group)
  const weighted = items.filter((i) => isWeighted(i.slug) && inGroup.some((e) => e.slug === i.slug))
  return (
    <Stack gap="sm" testID={`equipment-group-${group}`}>
      <Text variant="label" tone="muted">
        {EQUIPMENT_GROUP_LABELS[group]}
      </Text>
      <Stack direction="row" gap="xs" wrap>
        {inGroup.map((item) => (
          <Chip
            key={item.slug}
            label={item.name}
            selected={items.some((i) => i.slug === item.slug)}
            onPress={() => {
              onToggle(item.slug)
            }}
            testID={`have-${item.slug}`}
          />
        ))}
      </Stack>
      {weighted.map((item) => (
        <Weights
          key={item.slug}
          name={equipmentName(item.slug)}
          slug={item.slug}
          weights={item.weights ?? { stepG: null, minG: null, maxG: null }}
          onChange={(weights) => {
            onWeights(item.slug, weights)
          }}
        />
      ))}
    </Stack>
  )
}

/** How one item's weights go: the lightest, the step, the heaviest — empty for no cap. */
function Weights({
  name,
  slug,
  weights,
  onChange,
}: {
  readonly name: string
  readonly slug: string
  readonly weights: TypedWeights
  readonly onChange: (weights: TypedWeights) => void
}): React.JSX.Element {
  const unit = fieldFor('weight', useWeightUnit()).unit()
  const field = (key: keyof TypedWeights, label: string) => (
    <Stack grow>
      <DimensionInput
        dimension="weight"
        label={`${label} ${unit}`}
        value={weights[key]}
        onChange={(value) => {
          onChange({ ...weights, [key]: value })
        }}
        testID={`weights-${slug}-${key}`}
      />
    </Stack>
  )
  return (
    <Stack gap="xs" testID={`weights-${slug}`}>
      <Text variant="caption">{name}</Text>
      <Stack direction="row" gap="sm">
        {field('minG', 'From')}
        {field('stepG', 'Step')}
        {field('maxG', 'To')}
      </Stack>
    </Stack>
  )
}
