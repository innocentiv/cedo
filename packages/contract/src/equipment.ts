import { z } from 'zod'

/**
 * Equipment (#32): what an exercise is done with. An exercise needs some; an athlete has some. A
 * fixed list shipped with cedo — not user data — because an item one person invented would match no
 * exercise's needs, and so silently filter nothing. See docs/adr/0023-equipment-is-a-fixed-list.md.
 *
 * Each item is a CAPABILITY, not a product: an adjustable cable column is a high, a low and an
 * adjustable pulley; an adjustable bench is a flat and an incline one. An item that holds the load
 * is `weighted` — it has a weight step — and an exercise needs at most one of those.
 *
 * To add an item: add it at the end of its group. The order here is the checklist's. Removing or
 * renaming a slug needs a migration of every exercise that names it.
 */
export const EQUIPMENT_GROUPS = [
  'free_weights',
  'bars',
  'stations',
  'cables',
  'machines',
  'cardio',
] as const
export const EquipmentGroup = z.enum(EQUIPMENT_GROUPS)
export type EquipmentGroup = z.output<typeof EquipmentGroup>

/** A group as a person reads it: where the checklist puts its items. */
export const EQUIPMENT_GROUP_LABELS: Readonly<Record<EquipmentGroup, string>> = {
  free_weights: 'Free weights',
  bars: 'Bars',
  stations: 'Racks, benches and stations',
  cables: 'Cables',
  machines: 'Machines',
  cardio: 'Cardio',
}

export const EQUIPMENT = [
  { slug: 'dumbbells', name: 'Dumbbells', group: 'free_weights', weighted: true },
  { slug: 'kettlebells', name: 'Kettlebells', group: 'free_weights', weighted: true },
  { slug: 'weight_plates', name: 'Weight plates', group: 'free_weights', weighted: true },
  // Never needed: a pull-up is done without one. Owned, it steps every bodyweight exercise's load.
  { slug: 'weight_belt', name: 'Weight belt', group: 'free_weights', weighted: true },
  { slug: 'resistance_bands', name: 'Resistance bands', group: 'free_weights', weighted: false },
  // A barbell's weight is its total, so its least is the bar.
  { slug: 'barbell', name: 'Barbell', group: 'bars', weighted: true },
  { slug: 'ez_bar', name: 'EZ bar', group: 'bars', weighted: true },
  { slug: 'trap_bar', name: 'Trap bar', group: 'bars', weighted: true },
  // Squat stands and a power cage alike; a bench with its own uprights is a rack and a bench.
  { slug: 'rack', name: 'Rack', group: 'stations', weighted: false },
  { slug: 'flat_bench', name: 'Flat bench', group: 'stations', weighted: false },
  { slug: 'incline_bench', name: 'Incline bench', group: 'stations', weighted: false },
  { slug: 'pull_up_bar', name: 'Pull-up bar', group: 'stations', weighted: false },
  { slug: 'parallel_bars', name: 'Parallel bars', group: 'stations', weighted: false },
  {
    slug: 'back_extension_bench',
    name: 'Back extension bench',
    group: 'stations',
    weighted: false,
  },
  // A pulley fixed high is made for a pulldown, so a lat pulldown station is one.
  { slug: 'high_pulley', name: 'High pulley', group: 'cables', weighted: true },
  { slug: 'low_pulley', name: 'Low pulley', group: 'cables', weighted: true },
  { slug: 'adjustable_pulley', name: 'Adjustable pulley', group: 'cables', weighted: true },
  // Two pulleys facing each other, for what pulls with both hands from either side.
  { slug: 'cable_crossover', name: 'Cable crossover', group: 'cables', weighted: true },
  { slug: 'leg_press', name: 'Leg press', group: 'machines', weighted: true },
  { slug: 'leg_extension', name: 'Leg extension', group: 'machines', weighted: true },
  { slug: 'lying_leg_curl', name: 'Lying leg curl', group: 'machines', weighted: true },
  { slug: 'seated_leg_curl', name: 'Seated leg curl', group: 'machines', weighted: true },
  { slug: 'standing_calf_raise', name: 'Standing calf raise', group: 'machines', weighted: true },
  { slug: 'seated_calf_raise', name: 'Seated calf raise', group: 'machines', weighted: true },
  { slug: 'smith_machine', name: 'Smith machine', group: 'machines', weighted: true },
  { slug: 'hack_squat', name: 'Hack squat', group: 'machines', weighted: true },
  { slug: 'chest_press', name: 'Chest press', group: 'machines', weighted: true },
  { slug: 'shoulder_press', name: 'Shoulder press', group: 'machines', weighted: true },
  { slug: 'pec_deck', name: 'Pec deck', group: 'machines', weighted: true },
  { slug: 'hip_abduction', name: 'Hip abduction', group: 'machines', weighted: true },
  { slug: 'assisted_pull_up', name: 'Assisted pull-up', group: 'machines', weighted: true },
  { slug: 'rowing_ergometer', name: 'Rowing ergometer', group: 'cardio', weighted: false },
  { slug: 'treadmill', name: 'Treadmill', group: 'cardio', weighted: false },
  { slug: 'exercise_bike', name: 'Exercise bike', group: 'cardio', weighted: false },
] as const satisfies readonly {
  slug: string
  name: string
  group: EquipmentGroup
  weighted: boolean
}[]

export const EQUIPMENT_SLUGS = EQUIPMENT.map((e) => e.slug)

/** A real `z.enum`, so an AI calling an MCP tool is shown every item, as `MuscleSlug` is. */
export const EquipmentSlug = z.enum(EQUIPMENT_SLUGS)
export type EquipmentSlug = z.output<typeof EquipmentSlug>

const WEIGHTED: ReadonlySet<EquipmentSlug> = new Set(
  EQUIPMENT.filter((e) => e.weighted).map((e) => e.slug),
)

/** Whether an item holds the load, and so has a weight step. */
export const isWeighted = (slug: EquipmentSlug): boolean => WEIGHTED.has(slug)

/** Never needed: it loads an exercise done without it, as a pull-up is. */
const NEVER_NEEDED: EquipmentSlug = 'weight_belt'

/** What an exercise may need: every item but a weight belt. */
export const NEEDABLE_EQUIPMENT = EQUIPMENT.filter((e) => e.slug !== NEVER_NEEDED)

/** An item's name as a person reads it. */
export const equipmentName = (slug: EquipmentSlug): string =>
  EQUIPMENT.find((e) => e.slug === slug)?.name ?? slug

/**
 * What an exercise needs — all of it. `null` is undescribed: nobody has said yet, which is not the
 * same as needing nothing (`[]`, a push-up). An undescribed exercise is doable for everyone.
 */
export const ExerciseEquipment = z
  .array(EquipmentSlug)
  // The most a real exercise asks for is three or four (a bar, a rack, a bench); more is a mistake.
  .max(8)
  .nullable()
  .superRefine((items, ctx) => {
    if (items === null) return
    if (new Set(items).size !== items.length) {
      ctx.addIssue({ code: 'custom', message: 'Each item may be listed only once' })
    }
    if (items.includes(NEVER_NEEDED)) {
      ctx.addIssue({
        code: 'custom',
        message: 'No exercise needs a weight belt: it only loads one done without it',
      })
    }
    if (items.filter((item) => isWeighted(item)).length > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'An exercise holds its load on one item at most: dumbbells or a barbell, not both',
      })
    }
  })
  .describe(
    'Everything the exercise needs — an athlete without all of it cannot do it. [] needs ' +
      'nothing; null is not described yet. At most one item that holds the load (dumbbells, a ' +
      'bar, a pulley, a machine), and never weight_belt. A pulley fixed high serves a pulldown.',
  )
export type ExerciseEquipment = z.output<typeof ExerciseEquipment>

/**
 * What an exercise needs, in the words of wherever it is said: undescribed, nothing, or its items.
 * The one place the three are told apart, so no reader can take undescribed for nothing.
 */
export function sayEquipment(
  items: readonly EquipmentSlug[] | null,
  words: {
    readonly unsaid: string
    readonly nothing: string
    readonly listed: (items: readonly EquipmentSlug[]) => string
  },
): string {
  if (items === null) return words.unsaid
  return items.length === 0 ? words.nothing : words.listed(items)
}

/** `Barbell, Rack`, `None needed`, or `Not described` — one exercise's equipment in a line. */
export const equipmentLine = (items: readonly EquipmentSlug[] | null): string =>
  sayEquipment(items, {
    unsaid: 'Not described',
    nothing: 'None needed',
    listed: (slugs) => slugs.map((slug) => equipmentName(slug)).join(', '),
  })

/**
 * An item chosen or dropped on a form, or `'nothing'` — the exercise needs no equipment (#33).
 * Choosing an item ends "nothing", and choosing "nothing" drops every item; dropping the last item,
 * or "nothing" itself, goes back to undescribed rather than to needing nothing, which is a claim.
 */
export function withEquipmentToggled(
  items: readonly EquipmentSlug[] | null,
  choice: EquipmentSlug | 'nothing',
): EquipmentSlug[] | null {
  if (choice === 'nothing') return items !== null && items.length === 0 ? null : []
  const current = items ?? []
  if (!current.includes(choice)) return [...current, choice]
  const left = current.filter((item) => item !== choice)
  return left.length === 0 ? null : left
}
