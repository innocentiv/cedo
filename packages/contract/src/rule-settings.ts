import { type Dimension, fieldFor } from './dimension.ts'
import { withRange } from './entry-editing.ts'
import type { Load } from './load.ts'
import { DEFAULT_INCREMENT_MM, DEFAULT_INCREMENT_S, newIncrementG } from './plan-editing.ts'
import type { Progression } from './progression.ts'
import { unhandledKind } from './stored-rule.ts'
import type { WeightUnit } from './units.ts'
import type { WorkoutEntryInput } from './workout.ts'

/**
 * A rule's own settings, as the plan editor shows them (docs/08-frontend.md, "An entry's
 * settings"): which a rule has, in order, and what each becomes when changed — or emptied, as a
 * field is mid-edit, which falls back to a number rather than leave the rule without one. Here
 * rather than in the editor, where no test reached them.
 */

/** Which setting: a double's range, the increase every moving rule adds, a linear rule's streak. */
export type RuleSettingName = 'from' | 'to' | 'increase' | 'after'

export interface RuleSetting<E extends WorkoutEntryInput> {
  readonly name: RuleSettingName
  readonly label: string
  /** A whole count, typed as it is; or a measured quantity, typed in its unit (`fieldFor`). */
  readonly input: 'count' | Exclude<Dimension, 'reps'>
  /** In base units, as stored. */
  readonly value: number
  /** The entry with this setting changed to `value` — null when its field is emptied. */
  readonly change: (value: number | null) => E
}

type Streaked = Extract<Progression, { afterSuccesses: number }>
type Weighted = Extract<Progression, { incrementG: number }>

const withRule = <E extends WorkoutEntryInput>(entry: E, rule: Progression): E => ({
  ...entry,
  progression: rule,
})

/** After how many cleared sessions it moves: one at least, and above the schema's ten as typed. */
const after = <E extends WorkoutEntryInput>(entry: E, rule: Streaked): RuleSetting<E> => ({
  name: 'after',
  label: 'After sessions',
  input: 'count',
  value: rule.afterSuccesses,
  change: (n) => withRule(entry, { ...rule, afterSuccesses: n === null || n < 1 ? 1 : n }),
})

/** The weight it adds; emptied, a new rule's: one step of what can be loaded, else 2.5 kg or 5 lb. */
const weightIncrease = <E extends WorkoutEntryInput>(
  entry: E,
  rule: Weighted,
  unit: WeightUnit,
  load: Load | null,
): RuleSetting<E> => ({
  name: 'increase',
  label: `Increase, ${fieldFor('weight', unit).unit()}`,
  input: 'weight',
  value: rule.incrementG,
  change: (g) => withRule(entry, { ...rule, incrementG: g ?? newIncrementG(unit, load) }),
})

/** A double's range; an end emptied is 1, and the working sets' reps move into it (`withRange`). */
const range = <E extends WorkoutEntryInput>(
  entry: E,
  [from, to]: readonly [number, number],
): RuleSetting<E>[] => [
  {
    name: 'from',
    label: 'From',
    input: 'count',
    value: from,
    change: (n) => withRange(entry, [n ?? 1, to]),
  },
  {
    name: 'to',
    label: 'To',
    input: 'count',
    value: to,
    change: (n) => withRange(entry, [from, n ?? 1]),
  },
]

/**
 * The settings of an entry's rule, in the order the editor shows them — none under Manual. An
 * increase emptied falls back to a new rule's (`progressionOf`), in the person's `unit` and, for
 * weight, by what the athlete can load on the exercise (`load`, #36).
 */
export function ruleSettings<E extends WorkoutEntryInput>(
  entry: E,
  unit: WeightUnit,
  load: Load | null,
): readonly RuleSetting<E>[] {
  const rule = entry.progression
  switch (rule.kind) {
    case 'none':
      return []
    case 'linear':
      return [weightIncrease(entry, rule, unit, load), after(entry, rule)]
    case 'double':
      return [...range(entry, rule.repRange), weightIncrease(entry, rule, unit, load)]
    case 'linear_duration':
      return [
        {
          name: 'increase',
          label: 'Increase',
          input: 'duration',
          value: rule.incrementS,
          change: (s) => withRule(entry, { ...rule, incrementS: s ?? DEFAULT_INCREMENT_S }),
        },
        after(entry, rule),
      ]
    case 'linear_distance':
      return [
        {
          name: 'increase',
          label: 'Increase, m',
          input: 'distance',
          value: rule.incrementMm,
          change: (mm) => withRule(entry, { ...rule, incrementMm: mm ?? DEFAULT_INCREMENT_MM }),
        },
        after(entry, rule),
      ]
    default:
      return unhandledKind(rule)
  }
}
