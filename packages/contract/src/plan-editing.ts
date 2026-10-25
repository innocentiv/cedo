import { DIMENSION_FIELDS, WEIGHT_STEP_G, tracks } from './dimension.ts'
import { type Effort, formatEffort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import { NO_PROGRESSION, type Progression } from './progression.ts'
import { DEFAULT_REST_S } from './rest.ts'
import type { WeightUnit } from './units.ts'
import {
  MAX_DAYS_PER_PLAN,
  MAX_ENTRIES_PER_DAY,
  MAX_SETS_PER_ENTRY,
  type TargetFields,
  type WorkoutDayInput,
  type WorkoutEntryInput,
  WorkoutPlanInput,
  type WorkoutSetInput,
} from './workout.ts'

/**
 * The rules for editing a plan before it is saved — here rather than in the editor, where they
 * drifted from the schema with no test to notice: warm-ups and working sets were each clamped to 20
 * while the schema allows 20 IN TOTAL, and nothing stopped a fifteenth day or a forty-first entry.
 * Each was accepted on screen and refused on save. Pure functions over the plan's input shape, so
 * the editor — and anything else that builds a plan — gets the same answers, and the fast contract
 * tests hold them. See docs/08-frontend.md.
 */

/** Warm-up sets ramp up to the work; working sets are the prescription. See GLOSSARY.md. */
export type SetKind = 'warmup' | 'working'

/** A change to an entry's prescription. Never `isWarmup`: a target edit does not move a set. */
export type Prescription = Partial<TargetFields>

const split = (entry: WorkoutEntryInput) => ({
  warmup: entry.sets.filter((s) => s.isWarmup),
  working: entry.sets.filter((s) => !s.isWarmup),
})

/**
 * The weight a new rule adds, in the person's unit: 2.5 kg, or 5 lb — the smallest pair of plates
 * on each kind of bar. 2.5 kg shown to someone who reads pounds was "+5.51 lb", and after 135 lb
 * the next target read 140.51.
 */
export const DEFAULT_INCREMENT_G: Readonly<Record<WeightUnit, number>> = WEIGHT_STEP_G

/** The time a new duration rule adds. */
export const DEFAULT_INCREMENT_S = 15

/** The distance a new distance rule adds: 500 m. Distance is metric for everyone (units.ts). */
export const DEFAULT_INCREMENT_MM = 500_000

/** A new rule of each kind, in the person's unit — one per kind, or this does not compile. */
const NEW_RULE: { readonly [K in Progression['kind']]: (unit: WeightUnit) => Progression } = {
  none: () => NO_PROGRESSION,
  linear: (unit) => ({ kind: 'linear', incrementG: DEFAULT_INCREMENT_G[unit], afterSuccesses: 1 }),
  double: (unit) => ({ kind: 'double', repRange: [8, 12], incrementG: DEFAULT_INCREMENT_G[unit] }),
  linear_duration: () => ({
    kind: 'linear_duration',
    incrementS: DEFAULT_INCREMENT_S,
    afterSuccesses: 1,
  }),
  linear_distance: () => ({
    kind: 'linear_distance',
    incrementMm: DEFAULT_INCREMENT_MM,
    afterSuccesses: 1,
  }),
}

/**
 * A rule of `kind` — `previous` itself if it is that kind already, so switching away and back does
 * not lose its settings, otherwise a new one with its defaults in the person's `unit`.
 */
export const progressionOf = (
  kind: Progression['kind'],
  previous: Progression,
  unit: WeightUnit,
): Progression => (kind === previous.kind ? previous : NEW_RULE[kind](unit))

/** A new day, named by its position. */
export const newDay = (index: number): WorkoutDayInput => ({
  name: `Day ${index + 1}`,
  entries: [],
})

/**
 * A new entry starts with three working sets, which is what almost every prescription is — and with
 * a target in whatever the exercise actually measures. Seeding `targetReps` regardless left a plank
 * with three sets and an empty duration box.
 */
export const newEntry = (exercise: {
  readonly id: string
  readonly tracking: TrackingMode
}): WorkoutEntryInput => ({
  exerciseId: exercise.id,
  supersetGroup: null,
  restSeconds: DEFAULT_REST_S,
  cue: null,
  progression: NO_PROGRESSION,
  sets: Array.from({ length: 3 }, () => ({
    targetReps: tracks(exercise.tracking, 'reps') ? 8 : null,
    targetWeightG: null,
    targetRpe: null,
    targetDurationS: tracks(exercise.tracking, 'duration') ? 30 : null,
    targetDistanceMm: tracks(exercise.tracking, 'distance') ? 100_000 : null,
    isWarmup: false,
  })),
})

/**
 * The prescription is the FIRST WORKING set. Taking `sets[0]` instead showed a warm-up's light load
 * as the prescription. See docs/adr/0012-progression-rules.md.
 *
 * Over any shape of set — a plan being edited, a plan as read, the prescribed rows progression
 * evaluates — because the rule was written once for each of those, and is now written here.
 */
export const prescriptionOf = <S extends { readonly isWarmup: boolean }>(entry: {
  readonly sets: readonly S[]
}): S | undefined => entry.sets.find((s) => !s.isWarmup)

/**
 * `3 sets · 8 × 60 kg`: how many working sets, and the prescription they share (`prescriptionOf`),
 * in its exercise's terms — a mode of `null` for an unavailable exercise reads it as measured. Over
 * any shape of set, like `prescriptionOf`: a plan as read, or a draft's sets through `setTargetOf`.
 */
export function formatPrescription(
  sets: readonly { readonly isWarmup: boolean; readonly target: Effort }[],
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string {
  const working = sets.filter((s) => !s.isWarmup)
  const first = working[0]
  if (first === undefined) return 'no working sets'
  const count = `${working.length} set${working.length === 1 ? '' : 's'}`
  return `${count} · ${formatEffort(first.target, tracking, unit)}`
}

export const setCounts = (entry: WorkoutEntryInput): Record<SetKind, number> => {
  const { warmup, working } = split(entry)
  return { warmup: warmup.length, working: working.length }
}

/** A set with nothing prescribed — only for an entry that somehow has no working set to copy. */
const UNPRESCRIBED: WorkoutSetInput = {
  targetReps: null,
  targetWeightG: null,
  targetRpe: null,
  targetDurationS: null,
  targetDistanceMm: null,
  isWarmup: false,
}

/**
 * Rebuilds one band of sets to `count`, leaving the other untouched. A band can never push the
 * entry past `MAX_SETS_PER_ENTRY` in total: it gets what the other band leaves. There is always at
 * least one working set, as the schema requires; warm-ups may be none. New sets copy the
 * prescription.
 */
export function resizeSets<E extends WorkoutEntryInput>(
  entry: E,
  band: SetKind,
  count: number | null,
): E {
  const { warmup: warmups, working } = split(entry)
  const least = band === 'warmup' ? 0 : 1
  const room = MAX_SETS_PER_ENTRY - (band === 'warmup' ? working.length : warmups.length)
  const size = Math.max(least, Math.min(count ?? least, room))

  const template = { ...(prescriptionOf(entry) ?? UNPRESCRIBED), isWarmup: band === 'warmup' }
  const rebuilt = Array.from({ length: size }, () => ({ ...template }))
  return { ...entry, sets: band === 'warmup' ? [...rebuilt, ...working] : [...warmups, ...rebuilt] }
}

/** One prescription per entry: working sets never diverge. Warm-ups keep their own targets. */
export const prescribe = <E extends WorkoutEntryInput>(entry: E, patch: Prescription): E => ({
  ...entry,
  sets: entry.sets.map((s) => (s.isWarmup ? s : { ...s, ...patch })),
})

export const canAddDay = (days: readonly WorkoutDayInput[]): boolean =>
  days.length < MAX_DAYS_PER_PLAN

export const canAddEntry = (day: WorkoutDayInput): boolean =>
  day.entries.length < MAX_ENTRIES_PER_DAY

/**
 * A saved plan keeps one day at least (`WorkoutPlanInput`), and a plan edited in place is saved as
 * each change is made (#26): its last day cannot be removed, or the change could never be saved.
 */
export const canRemoveDay = (days: readonly WorkoutDayInput[]): boolean => days.length > 1

/**
 * The name to keep from what was typed (#26): trimmed — or `undefined` when there is nothing to
 * send, it being what is already kept, or nothing, which no workout or day may be called.
 */
export function nameToKeep(typed: string, kept: string): string | undefined {
  const said = typed.trim()
  return said === '' || said === kept ? undefined : said
}

/**
 * Why a draft would be refused on save, one line per problem, located by day and exercise — the
 * schema's own verdict, read before the request rather than after it. The editor prevents what it
 * can; this catches whatever it does not model, without restating a rule.
 *
 * And first, every entry whose exercise is not `visible` to the editor: an unavailable exercise,
 * which the server refuses a plan for — a plan may only use exercises its owner can read. Required,
 * so no editor can forget to say what it can see.
 */
export function planIssues(
  plan: WorkoutPlanInput,
  visible: { readonly has: (exerciseId: string) => boolean },
): string[] {
  const unavailable = plan.days.flatMap((day, d) =>
    day.entries.flatMap((entry, e) =>
      visible.has(entry.exerciseId)
        ? []
        : [`Day ${d + 1}, exercise ${e + 1}: Unavailable exercise — remove it to save`],
    ),
  )
  const result = WorkoutPlanInput.safeParse(plan)
  if (result.success) return unavailable
  // Every working set carries the same prescription, so one bad target is one problem — not one
  // line per set. The set's number is left out for the same reason.
  return [
    ...unavailable,
    ...new Set(result.error.issues.map((issue) => `${where(issue.path)}${issue.message}`)),
  ]
}

/**
 * A field as a person names it: a target by what it measures (`weight`, `duration`), the rest by
 * plain words. Not by the unit it is typed in: a label like `m:ss` or `lb` is a format, and
 * "m:ss: Must be more than 0" names nothing.
 */
const FIELD_NAMES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.values(DIMENSION_FIELDS).map((f) => [f.targetKey, f.dimension])),
  targetRpe: 'RPE',
  name: 'name',
  sets: 'sets',
  entries: 'exercises',
  exerciseId: 'exercise',
  restSeconds: 'rest',
  cue: 'cue',
  supersetGroup: 'superset',
  progression: 'progression',
}

/**
 * `Day 2, exercise 1, reps: ` — the day and exercise by position, then the deepest field the problem
 * is about, by name: a bad target on a set reads as its unit, not as `sets`. Anything inside a
 * progression rule is the rule's.
 */
function where(path: readonly PropertyKey[]): string {
  const day = path[0] === 'days' && typeof path[1] === 'number' ? path[1] : null
  const entry =
    day !== null && path[2] === 'entries' && typeof path[3] === 'number' ? path[3] : null
  if (day === null) return ''
  const rest = path.slice(entry === null ? 2 : 4)
  const field = rest.includes('progression')
    ? 'progression'
    : rest.findLast((segment): segment is string => typeof segment === 'string')
  const located = entry === null ? [`Day ${day + 1}`] : [`Day ${day + 1}`, `exercise ${entry + 1}`]
  const named = field === undefined ? [] : [FIELD_NAMES[field] ?? field]
  return `${[...located, ...named].join(', ')}: `
}
