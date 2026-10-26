import { z } from 'zod'
import { WEIGHT_STEP_G } from './dimension.ts'
import { EQUIPMENT, EquipmentSlug, isWeighted } from './equipment.ts'
import { type WeightUnit, formatWeight, lbToG } from './units.ts'

/**
 * What an athlete has to train with (#34): the items, and for one that holds the load, how fine its
 * weights go. One per athlete; changing it applies from then on. See GLOSSARY.md, "Weight step".
 */

/** How an item's load goes, in grams: from `minG`, `stepG` at a time, up to `maxG` when there is one. */
export const ItemWeights = z
  .strictObject({
    stepG: z.int().positive().max(50_000),
    /** The least it loads: a barbell's bar, the lightest dumbbell. */
    minG: z.int().nonnegative().max(1_000_000),
    /** The most — the heaviest dumbbell. None is no cap, as a barbell with plates to spare. */
    maxG: z.int().positive().max(1_000_000).nullable(),
  })
  .refine((w) => w.maxG === null || w.maxG >= w.minG, {
    message: 'The heaviest cannot be lighter than the lightest',
    path: ['maxG'],
  })
export type ItemWeights = z.output<typeof ItemWeights>

/** One item an athlete has. `weights` only on an item that holds the load; null there is unknown. */
export const OwnedItem = z.strictObject({
  slug: EquipmentSlug,
  weights: ItemWeights.nullable(),
})
export type OwnedItem = z.output<typeof OwnedItem>

/** Everything an athlete has, replaced whole: `PUT /equipment`, and the MCP's `equipment_set`. */
export const AthleteEquipmentInput = z.strictObject({
  items: z
    .array(OwnedItem)
    .max(EQUIPMENT.length)
    .superRefine((items, ctx) => {
      const slugs = items.map((i) => i.slug)
      if (new Set(slugs).size !== slugs.length) {
        ctx.addIssue({ code: 'custom', message: 'Each item may be listed only once' })
      }
      items.forEach((i, at) => {
        if (i.weights !== null && !isWeighted(i.slug)) {
          ctx.addIssue({
            code: 'custom',
            path: [at, 'weights'],
            message: 'Only an item that holds the load has weights',
          })
        }
      })
    })
    .describe(
      'Everything you have to train with — what is left out, you do not have. For an item that ' +
        'holds the load, `weights` in GRAMS: the lightest, the step between, and the heaviest ' +
        '(null for no cap); null when not known.',
    ),
})
export type AthleteEquipmentInput = z.output<typeof AthleteEquipmentInput>

/**
 * An athlete's equipment as read. `described` false is someone who has not said yet — nothing is
 * filtered for them — which an empty list, someone with nothing at all, is not.
 */
export const AthleteEquipment = z.object({
  described: z.boolean(),
  items: z.array(OwnedItem),
})
export type AthleteEquipment = z.output<typeof AthleteEquipment>

/** `from 2 kg to 30 kg, by 2 kg`, or `from 20 kg up, by 2.5 kg`: how an item's weights go. */
export const weightsLine = (weights: ItemWeights, unit: WeightUnit): string => {
  const top = weights.maxG === null ? 'up' : `to ${formatWeight(weights.maxG, unit)}`
  return `from ${formatWeight(weights.minG, unit)} ${top}, by ${formatWeight(weights.stepG, unit)}`
}

/** The bar alone: what a bar's weights start from, in the unit its plates are bought in. */
const BAR_G: Partial<Record<EquipmentSlug, Readonly<Record<WeightUnit, number>>>> = {
  barbell: { kg: 20_000, lb: lbToG(45) },
  ez_bar: { kg: 10_000, lb: lbToG(25) },
  trap_bar: { kg: 25_000, lb: lbToG(55) },
}

/**
 * Where an item's weights start, ticked with nothing known: the usual step of the person's unit,
 * from the bar on a bar, from nothing on a belt, and from one step on anything else.
 */
export function defaultWeights(slug: EquipmentSlug, unit: WeightUnit): ItemWeights {
  const stepG = WEIGHT_STEP_G[unit]
  const minG = BAR_G[slug]?.[unit] ?? (slug === 'weight_belt' ? 0 : stepG)
  return { stepG, minG, maxG: null }
}

/** Weights as they are being typed: a field emptied is null on the way to its next number. */
export interface TypedWeights {
  readonly stepG: number | null
  readonly minG: number | null
  readonly maxG: number | null
}

/** An item on the checklist, its weights as typed so far. Any item as read is one already. */
export interface DraftItem {
  readonly slug: EquipmentSlug
  readonly weights: TypedWeights | null
}

/** What the checklist saves: weights whose step or least is left empty are not known. */
export const equipmentInputFrom = (items: readonly DraftItem[]): AthleteEquipmentInput => ({
  items: items.map(({ slug, weights: w }) => ({
    slug,
    weights:
      w === null || w.stepG === null || w.minG === null
        ? null
        : { stepG: w.stepG, minG: w.minG, maxG: w.maxG },
  })),
})

const PULLEYS: ReadonlySet<EquipmentSlug> = new Set([
  'high_pulley',
  'low_pulley',
  'adjustable_pulley',
  'cable_crossover',
])

/**
 * An item ticked or unticked on the checklist. Ticked, an item that holds the load starts at its
 * default weights — or, a pulley, at the weights of a pulley already ticked: one cable column is
 * usually one stack, typed once.
 */
export function withItemToggled(
  items: readonly DraftItem[],
  slug: EquipmentSlug,
  unit: WeightUnit,
): DraftItem[] {
  if (items.some((i) => i.slug === slug)) return items.filter((i) => i.slug !== slug)
  if (!isWeighted(slug)) return [...items, { slug, weights: null }]
  const pulley = PULLEYS.has(slug)
    ? items.find((i) => PULLEYS.has(i.slug) && i.weights !== null)
    : undefined
  return [...items, { slug, weights: pulley?.weights ?? defaultWeights(slug, unit) }]
}

/** Several items ticked at once (#34): a column, a bench, a whole gym. */
export const EQUIPMENT_SHORTCUTS: readonly {
  readonly name: string
  readonly items: readonly EquipmentSlug[]
}[] = [
  {
    name: 'Adjustable cable column',
    items: ['high_pulley', 'low_pulley', 'adjustable_pulley'],
  },
  { name: 'Adjustable bench', items: ['flat_bench', 'incline_bench'] },
  { name: 'A full gym', items: EQUIPMENT.map((e) => e.slug) },
]

/** A shortcut's items ticked, each as ticking it would; what is ticked already stays as it is. */
export const withShortcut = (
  items: readonly DraftItem[],
  shortcut: readonly EquipmentSlug[],
  unit: WeightUnit,
): DraftItem[] =>
  shortcut.reduce<DraftItem[]>(
    (sofar, slug) =>
      sofar.some((i) => i.slug === slug) ? sofar : withItemToggled(sofar, slug, unit),
    [...items],
  )

/**
 * Someone's equipment an item a line, in the words of wherever it is read: undescribed, nothing at
 * all, or each item by name and, holding the load, how its weights go. The one place the three are
 * told apart, as `sayEquipment` is for what an exercise needs.
 */
export function ownedLines(
  equipment: AthleteEquipment,
  unit: WeightUnit,
  words: {
    readonly unsaid: string
    readonly nothing: string
    readonly name: (slug: EquipmentSlug) => string
  },
): string[] {
  if (!equipment.described) return [words.unsaid]
  if (equipment.items.length === 0) return [words.nothing]
  return equipment.items.map(({ slug, weights }) => {
    if (!isWeighted(slug)) return words.name(slug)
    return `${words.name(slug)}: ${weights === null ? 'weights not known' : weightsLine(weights, unit)}`
  })
}
