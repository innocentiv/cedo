import { z } from 'zod'
import { formatEffort } from './effort.ts'
import { LoggedEffort, LoggedExercise } from './log.ts'
import { MUSCLES } from './muscle.ts'
import { Timestamp } from './primitives.ts'
import { Reserve } from './rpe.ts'
import { formatStall } from './stall.ts'
import { type WeightUnit, formatWeight } from './units.ts'
import { BodyweightTrend } from './weigh-in.ts'
import { counted } from './week.ts'

/**
 * The training review (#28): what a coach would look at, read in one call — by an AI through
 * `training_review`, and by the athlete on the Progress tab, over HTTP. Aggregation over what is
 * logged, judged by the rules in GLOSSARY.md ("Stalled", "Falling", "Effort drift", "Declined
 * muscle"), never new rules here. See docs/07-mcp.md and the API's `review/service.ts`.
 */

/** `GET /review` — how many weeks back to look; the period before is compared against. */
export const ReviewQuery = z.strictObject({
  weeks: z.coerce.number().int().min(1).max(52).default(8),
})
export type ReviewQuery = z.output<typeof ReviewQuery>

/**
 * The work one muscle got, in WORKING SETS by its share of each exercise's load — a set of a 70/30
 * exercise is 0.7 here — so every tracking mode counts alike; and what was lifted, for loaded work.
 */
export const MuscleWork = z.object({
  /** Its slug (`MUSCLES`). */
  muscle: z.string(),
  /** To one decimal; `changePct` compares the unrounded sums. */
  weightedSets: z.number().nonnegative(),
  /** Weight × reps, in grams — 0 for work that carries no load. */
  liftedG: z.int().nonnegative(),
  /** Against the period before; null when that period had none. */
  changePct: z.int().nullable(),
  /** Half or less of its sets in the period before (GLOSSARY.md, "Declined muscle"). */
  declined: z.boolean(),
})
export type MuscleWork = z.output<typeof MuscleWork>

/** A top set and, when one was said, how hard it was: a stall's set is worth both. */
export const RatedEffort = LoggedEffort.extend({ reserve: Reserve.nullable() })
export type RatedEffort = z.output<typeof RatedEffort>

/** The same top set, sessions running (GLOSSARY.md, "Stalled"): change something. */
export const Stalled = z.object({
  exercise: LoggedExercise,
  sessions: z.int().positive(),
  effort: RatedEffort,
})
export type Stalled = z.output<typeof Stalled>

/** A weight lift's estimated max falling, session after session (GLOSSARY.md, "Falling"). */
export const Falling = z.object({
  exercise: LoggedExercise,
  sessions: z.int().positive(),
  fromG: z.int(),
  toG: z.int(),
})
export type Falling = z.output<typeof Falling>

/**
 * The same set left with fewer reps in reserve each time (GLOSSARY.md, "Effort drift"): averages,
 * so to one decimal — an average is not a rating, and may be a fraction.
 */
export const EffortDrift = z.object({
  exercise: LoggedExercise,
  effort: LoggedEffort,
  fromReserve: z.number(),
  toReserve: z.number(),
})
export type EffortDrift = z.output<typeof EffortDrift>

export const TrainingReview = z.object({
  weeks: z.int().positive(),
  adherence: z.object({
    sessions: z.int().nonnegative(),
    perWeek: z.number().nonnegative(),
    currentStreakDays: z.int().nonnegative(),
    longestGapDays: z.int().nonnegative(),
    lastSessionAt: Timestamp.nullable(),
  }),
  /** Which planned days get trained, and so which get skipped. */
  dayBalance: z.array(z.object({ day: z.string(), workout: z.string(), sessions: z.int() })),
  muscleWork: z.object({
    /** The muscles worked most, most first. */
    top: z.array(MuscleWork),
    /** Declined muscles not already in `top`, the most sets lost first. */
    declined: z.array(MuscleWork),
    /** Muscles worked in either period that neither list names. */
    omitted: z.int().nonnegative(),
  }),
  stalled: z.array(Stalled),
  falling: z.array(Falling),
  effortDrift: z.array(EffortDrift),
  /** Their bodyweight, and its change over the period (#42) — null with no weigh-in at all. */
  bodyweight: BodyweightTrend.nullable(),
  /**
   * The age they turn this year, when they have said the year they were born (#42) — the age, never
   * the year: only they are shown that.
   */
  age: z.int().nullable(),
})
export type TrainingReview = z.output<typeof TrainingReview>

/** A muscle's work, as the Progress tab lists it (#28). */
export interface MuscleRow {
  readonly muscle: string
  readonly name: string
  /** `12.5 sets`. */
  readonly sets: string
  /** `+20%`, `−35%`, or `new` when the period before had none. */
  readonly change: string
  /** Its sets against the most worked muscle's: how long its bar is, 0 to 1. */
  readonly share: number
  /** Half or less of the period before: said apart, wherever it is listed. */
  readonly declined: boolean
}

/** `+20%`, `−35%`, `new`: a change against the period before, as a list shows it. */
export const formatChange = (changePct: number | null): string =>
  changePct === null
    ? 'new'
    : `${changePct > 0 ? '+' : changePct < 0 ? '−' : ''}${String(Math.abs(changePct))}%`

/** The muscles the review names, most worked first and the declined after, ready to list. */
export function muscleRows(work: TrainingReview['muscleWork']): {
  readonly top: MuscleRow[]
  readonly declined: MuscleRow[]
} {
  const most = Math.max(0, ...[...work.top, ...work.declined].map((m) => m.weightedSets))
  const row = (m: MuscleWork): MuscleRow => ({
    muscle: m.muscle,
    name: MUSCLES.find((x) => x.slug === m.muscle)?.name ?? m.muscle,
    sets: counted(m.weightedSets, 'set'),
    change: formatChange(m.changePct),
    share: most === 0 ? 0 : m.weightedSets / most,
    declined: m.declined,
  })
  return { top: work.top.map(row), declined: work.declined.map(row) }
}

/** `4 sessions at 5 × 80 kg`: the top set an exercise keeps repeating, as the stall says it. */
export const stallLine = (s: Stalled, unit: WeightUnit): string =>
  formatStall(s, s.exercise.tracking, unit)

/** `Estimated max 77 kg → 70 kg, 2 sessions running`. */
export const fallingLine = (f: Falling, unit: WeightUnit): string =>
  `Estimated max ${formatWeight(f.fromG, unit)} → ${formatWeight(f.toG, unit)}, ${counted(f.sessions, 'session')} running`

/**
 * `5 × 60 kg: 3 → 1 in reserve` — effort drift said as it is asked, reps in reserve; averages, as
 * the review gives them, to one decimal.
 */
export const driftLine = (d: EffortDrift, unit: WeightUnit): string =>
  `${formatEffort(d.effort, d.exercise.tracking, unit)}: ${String(d.fromReserve)} → ${String(d.toReserve)} in reserve`
