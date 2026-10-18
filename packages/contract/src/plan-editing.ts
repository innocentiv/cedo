import { tracks } from './dimension.ts'
import type { TrackingMode } from './exercise.ts'
import { NO_PROGRESSION } from './progression.ts'
import {
  MAX_DAYS_PER_PLAN,
  MAX_ENTRIES_PER_DAY,
  MAX_SETS_PER_ENTRY,
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

export type SetBand = 'warmup' | 'working'

/** A new day, named by its position. */
export const newDay = (index: number): WorkoutDayInput => ({
  name: `Day ${index + 1}`,
  entries: [],
})

/**
 * A new entry starts with three working sets, which is what almost every prescription is — and with
 * a target in whatever the exercise actually measures. Seeding `targetReps` regardless left a plank
 * with three sets and an empty seconds box.
 */
export const newEntry = (exercise: {
  readonly id: string
  readonly tracking: TrackingMode
}): WorkoutEntryInput => ({
  exerciseId: exercise.id,
  supersetGroup: null,
  restSeconds: 120,
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
 * The prescription is the FIRST WORKING set — which is also what progression reads. Taking `sets[0]`
 * instead showed a warm-up's light load as the prescription. See docs/adr/0012-progression-rules.md.
 */
export const prescriptionOf = (entry: WorkoutEntryInput): WorkoutSetInput | undefined =>
  entry.sets.find((s) => !s.isWarmup)

export const setCounts = (entry: WorkoutEntryInput): Record<SetBand, number> => ({
  warmup: entry.sets.filter((s) => s.isWarmup).length,
  working: entry.sets.filter((s) => !s.isWarmup).length,
})

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
export function resizeSets(
  entry: WorkoutEntryInput,
  band: SetBand,
  count: number | null,
): WorkoutEntryInput {
  const warmups = entry.sets.filter((s) => s.isWarmup)
  const working = entry.sets.filter((s) => !s.isWarmup)
  const least = band === 'warmup' ? 0 : 1
  const room = MAX_SETS_PER_ENTRY - (band === 'warmup' ? working.length : warmups.length)
  const size = Math.max(least, Math.min(count ?? least, room))

  const template = { ...(prescriptionOf(entry) ?? UNPRESCRIBED), isWarmup: band === 'warmup' }
  const rebuilt = Array.from({ length: size }, () => ({ ...template }))
  return { ...entry, sets: band === 'warmup' ? [...rebuilt, ...working] : [...warmups, ...rebuilt] }
}

/** One prescription per entry: working sets never diverge. Warm-ups keep their own targets. */
export const prescribe = (
  entry: WorkoutEntryInput,
  patch: Partial<Omit<WorkoutSetInput, 'isWarmup'>>,
): WorkoutEntryInput => ({
  ...entry,
  sets: entry.sets.map((s) => (s.isWarmup ? s : { ...s, ...patch })),
})

export const canAddDay = (days: readonly WorkoutDayInput[]): boolean =>
  days.length < MAX_DAYS_PER_PLAN

export const canAddEntry = (day: WorkoutDayInput): boolean =>
  day.entries.length < MAX_ENTRIES_PER_DAY

/**
 * Why a draft would be refused on save, one line per problem, located by day and exercise — the
 * schema's own verdict, read before the request rather than after it. The editor prevents what it
 * can; this catches whatever it does not model, without restating a rule.
 */
export function planIssues(plan: unknown): string[] {
  const result = WorkoutPlanInput.safeParse(plan)
  if (result.success) return []
  return result.error.issues.map((issue) => `${where(issue.path)}${issue.message}`)
}

/** `Day 2, exercise 1, sets: ` — the day and exercise by position, then the field, if any. */
function where(path: readonly PropertyKey[]): string {
  const day = path[0] === 'days' && typeof path[1] === 'number' ? path[1] : null
  const entry =
    day !== null && path[2] === 'entries' && typeof path[3] === 'number' ? path[3] : null
  if (day === null) return ''
  const field = path
    .slice(entry === null ? 2 : 4)
    .find((segment): segment is string => typeof segment === 'string')
  const located = entry === null ? [`Day ${day + 1}`] : [`Day ${day + 1}`, `exercise ${entry + 1}`]
  return `${[...located, ...(field === undefined ? [] : [field])].join(', ')}: `
}
