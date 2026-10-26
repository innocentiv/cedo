import { describe, expect, test } from 'bun:test'
import {
  AthleteEquipmentInput,
  EQUIPMENT_SHORTCUTS,
  defaultWeights,
  equipmentInputFrom,
  weightsLine,
  withItemToggled,
  withShortcut,
} from './athlete-equipment.ts'
import { lbToG } from './units.ts'

const dumbbells = { stepG: 2000, minG: 2000, maxG: 30_000 }

describe("an athlete's equipment", () => {
  test('nothing at all is an answer, as is an item with its weights unknown', () => {
    expect(AthleteEquipmentInput.safeParse({ items: [] }).success).toBe(true)
    expect(
      AthleteEquipmentInput.safeParse({ items: [{ slug: 'dumbbells', weights: null }] }).success,
    ).toBe(true)
  })

  test('dumbbells that go 2 kg at a time, from 2 to 30', () => {
    const parsed = AthleteEquipmentInput.parse({
      items: [{ slug: 'dumbbells', weights: dumbbells }],
    })
    expect(parsed.items[0]?.weights).toEqual(dumbbells)
  })

  test('refuses an item twice, weights on what holds no load, and a heaviest below the lightest', () => {
    const refused = (items: unknown) => !AthleteEquipmentInput.safeParse({ items }).success
    expect(
      refused([
        { slug: 'rack', weights: null },
        { slug: 'rack', weights: null },
      ]),
    ).toBe(true)
    expect(refused([{ slug: 'rack', weights: dumbbells }])).toBe(true)
    expect(refused([{ slug: 'dumbbells', weights: { ...dumbbells, maxG: 1000 } }])).toBe(true)
    expect(refused([{ slug: 'dumbbells', weights: { ...dumbbells, stepG: 0 } }])).toBe(true)
  })
})

test('how weights go, read in the person’s unit', () => {
  expect(weightsLine({ stepG: 2000, minG: 2000, maxG: 30_000 }, 'kg')).toBe(
    'from 2 kg to 30 kg, by 2 kg',
  )
  expect(weightsLine({ stepG: 2500, minG: 20_000, maxG: null }, 'kg')).toBe(
    'from 20 kg up, by 2.5 kg',
  )
})

describe('ticked on the checklist', () => {
  test('saved, weights with a step or a least left empty are not known; no top is no cap', () => {
    expect(
      equipmentInputFrom([
        { slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: null } },
        { slug: 'kettlebells', weights: { stepG: null, minG: 4000, maxG: 32_000 } },
        { slug: 'barbell', weights: { stepG: 2500, minG: null, maxG: null } },
        { slug: 'rack', weights: null },
      ]).items,
    ).toEqual([
      { slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: null } },
      { slug: 'kettlebells', weights: null },
      { slug: 'barbell', weights: null },
      { slug: 'rack', weights: null },
    ])
  })

  test('a bar starts from the bar, a belt from nothing, anything else from one step', () => {
    expect(defaultWeights('barbell', 'kg')).toEqual({ stepG: 2500, minG: 20_000, maxG: null })
    expect(defaultWeights('barbell', 'lb').minG).toBe(lbToG(45))
    expect(defaultWeights('weight_belt', 'kg').minG).toBe(0)
    expect(defaultWeights('dumbbells', 'kg')).toEqual({ stepG: 2500, minG: 2500, maxG: null })
  })

  test('an item that holds no load carries no weights, and ticked again is gone', () => {
    const rack = withItemToggled([], 'rack', 'kg')
    expect(rack).toEqual([{ slug: 'rack', weights: null }])
    expect(withItemToggled(rack, 'rack', 'kg')).toEqual([])
  })

  test("a second pulley starts at the first one's weights: one column, one stack", () => {
    const stack = { stepG: 5000, minG: 5000, maxG: 100_000 }
    const high = [{ slug: 'high_pulley' as const, weights: stack }]
    expect(withItemToggled(high, 'low_pulley', 'kg')).toContainEqual({
      slug: 'low_pulley',
      weights: stack,
    })
    // Anything else starts at its own.
    expect(withItemToggled(high, 'leg_press', 'kg')).toContainEqual({
      slug: 'leg_press',
      weights: defaultWeights('leg_press', 'kg'),
    })
  })

  test('a shortcut ticks what it names, and leaves what is ticked as it is', () => {
    const column = EQUIPMENT_SHORTCUTS.find((s) => s.name === 'Adjustable cable column')
    if (column === undefined) throw new Error('no column shortcut')
    const mine = [{ slug: 'low_pulley' as const, weights: { stepG: 7000, minG: 7000, maxG: null } }]
    const after = withShortcut(mine, column.items, 'kg')
    expect(after.map((i): string => i.slug).toSorted()).toEqual([
      'adjustable_pulley',
      'high_pulley',
      'low_pulley',
    ])
    expect(after.every((i) => i.weights?.stepG === 7000)).toBe(true)
  })
})
