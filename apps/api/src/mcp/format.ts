import type {
  Exercise,
  ExerciseHistory,
  ProgressionSuggestion,
  TrackingMode,
  WeightUnit,
  Workout,
  WorkoutSummary,
  MuscleWork,
  TrainingReview,
} from '@cedo/contract'
import {
  AT_LEAST_SESSIONS,
  estimatedMax,
  formatDuration,
  formatEffort,
  formatStall,
  formatWeight,
  pointsOf,
} from '@cedo/contract'
import { DRIFT_RPE, DRIFT_SESSIONS, FALLING_SESSIONS } from '../modules/review/service.ts'

/**
 * Tool output is TEXT the model reads, and its size is the real cost of an MCP tool — not the
 * number of calls. A survey of forty exercises as raw JSON with nested media is tens of kilobytes
 * of context; the same information as lines is a tenth of that.
 *
 * The rule: compact text for anything the model READS, JSON only for what it must round-trip back
 * into another tool (a plan it is about to edit). See docs/07-mcp.md.
 */

export const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })

export const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const muscles = (exercise: Exercise) =>
  exercise.muscles
    .toSorted((a, b) => b.loadPct - a.loadPct)
    .map((m) => `${m.muscle} ${m.loadPct}%`)
    .join(', ')

/** One line per exercise: enough to decide, not enough to bloat context. */
export function exerciseLine(exercise: Exercise): string {
  const flags = [
    exercise.tracking === 'weight_reps' ? null : exercise.tracking,
    exercise.isUnilateral ? 'unilateral' : null,
    exercise.canEdit ? null : 'read-only',
  ].filter(Boolean)

  return [
    exercise.name,
    exercise.equipment ?? 'bodyweight',
    muscles(exercise),
    flags.length > 0 ? `[${flags.join(', ')}]` : '',
    exercise.id,
  ]
    .filter((part) => part !== '')
    .join(' | ')
}

export function exerciseDetail(exercise: Exercise): string {
  return [
    `${exercise.name}  (${exercise.id})`,
    `tracking: ${exercise.tracking}${exercise.isUnilateral ? ', unilateral' : ''}`,
    `equipment: ${exercise.equipment ?? 'bodyweight'}`,
    `muscles: ${muscles(exercise)}`,
    exercise.description === '' ? null : `description: ${exercise.description}`,
    exercise.instructions === '' ? null : `instructions: ${exercise.instructions}`,
    exercise.media.length === 0
      ? 'media: none'
      : `media:\n${exercise.media.map((m) => `  - ${m.kind}: ${m.url}`).join('\n')}`,
    `editable: ${exercise.canEdit ? 'yes' : 'no (owned by another group)'}`,
  ]
    .filter((line) => line !== null)
    .join('\n')
}

export const workoutLine = (workout: WorkoutSummary): string =>
  `${workout.name} | ${workout.dayCount} day${workout.dayCount === 1 ? '' : 's'}` +
  `${workout.canEdit ? '' : ' | read-only'} | ${workout.id}`

/**
 * Every effort below goes through the contract's `formatEffort`, so the AI reads a set exactly as
 * the app shows it. Hand-rolled here, a run's target read "no target set" (distance was dropped)
 * while the app said "5 km in 25m 0s".
 */
const setLine = (
  set: Workout['days'][number]['entries'][number]['sets'][number],
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string =>
  `${set.isWarmup ? 'warm-up' : 'work'}: ${formatEffort(set.target, tracking, unit)}${atRpe(set.target.rpe)}`

/** ` @ RPE 8.5` after a set prescribed or logged at one, and nothing after one without. */
export const atRpe = (rpe: number | null): string => (rpe === null ? '' : ` @ RPE ${rpe}`)

/** The whole plan as an outline. A 6-day plan is ~60 short lines rather than ~40 KB of JSON. */
export function workoutDetail(workout: Workout, unit: WeightUnit): string {
  const header = `${workout.name}  (${workout.id})${workout.canEdit ? '' : '  [read-only]'}`
  const notes = workout.notes === null ? [] : [`notes: ${workout.notes}`]

  const days = workout.days.map((day) => {
    const entries = day.entries.map((entry) => {
      const superset = entry.supersetGroup === null ? '' : ` (superset ${entry.supersetGroup})`
      const rest = entry.restSeconds === null ? '' : `, rest ${formatDuration(entry.restSeconds)}`
      const rule =
        entry.progression.kind === 'none' ? '' : `, progression: ${entry.progression.kind}`
      // Null when the caller cannot see the exercise — see the note on WorkoutEntry.exercise.
      const name = entry.exercise?.name ?? '[unavailable exercise]'
      return [
        `  - ${name}${superset}${rest}${rule}   [entry ${entry.id}]`,
        ...(entry.cue === null ? [] : [`      cue: ${entry.cue}`]),
        ...entry.sets.map((set) => `      ${setLine(set, entry.exercise?.tracking ?? null, unit)}`),
      ].join('\n')
    })
    // Its name, as the app shows a day: the outline's order is already its position, and a day
    // named the way people name them — "Day 1 · Push" — was said twice under a number of ours.
    return [day.name, ...entries].join('\n')
  })

  return [header, ...notes, '', ...days].join('\n')
}

export function suggestionLines(
  suggestions: readonly ProgressionSuggestion[],
  unit: WeightUnit,
): string {
  if (suggestions.length === 0) return 'This workout has no entries yet.'

  return suggestions
    .map((s) => {
      const from = describeTarget(s.current, s.tracking, unit)
      const to = describeTarget(s.suggested, s.tracking, unit)
      const basis = `${s.sessionsConsidered} session${s.sessionsConsidered === 1 ? '' : 's'} of history`
      return s.changed
        ? `${s.exerciseName}: ${from} -> ${to}  (${s.rule.kind}, from ${basis})`
        : `${s.exerciseName}: hold at ${from}  (${s.rule.kind}, from ${basis})`
    })
    .join('\n')
}

function describeTarget(
  target: ProgressionSuggestion['current'],
  tracking: TrackingMode,
  unit: WeightUnit,
): string {
  const effort = formatEffort(target, tracking, unit)
  return effort === '—' ? 'no target set' : effort
}

/**
 * `Bench Press: 4 sessions at 8 × 60 kg` — the top set those sessions share, in its exercise's own
 * terms, like every other effort here: no unit arithmetic of its own.
 */
function stalledLine(s: TrainingReview['stalled'][number], unit: WeightUnit): string {
  const estimate = estimatedMax({ ...s.effort, rpe: s.effort.rpe ?? null }, s.exercise.tracking)
  const max = estimate === null ? '' : ` (estimated max ${formatWeight(estimate, unit)})`
  return `${s.exercise.name}: ${formatStall(s, s.exercise.tracking, unit)}${max}`
}

/**
 * The deload signals, each under its own heading and only when there is one to say: an empty
 * "nothing is falling" beside "nothing looks stalled" is context spent on no news. See ./deload.ts.
 */
function deloadSections(review: TrainingReview, unit: WeightUnit): string[] {
  const sections: string[] = []
  if (review.falling.length > 0) {
    sections.push(
      `Falling (estimated max from what was lifted, down ${FALLING_SESSIONS}+ sessions running):\n  ${review.falling
        .map(
          (f) =>
            `${f.exercise.name}: down in each of the latest ${f.sessions} sessions, ${formatWeight(f.fromG, unit)} → ${formatWeight(f.toG, unit)}`,
        )
        .join('\n  ')}`,
    )
  }
  if (review.effortDrift.length > 0) {
    sections.push(
      `Effort drift (RPE up ${DRIFT_RPE}+ at the same set, in each of the latest ${DRIFT_SESSIONS} sessions):\n  ${review.effortDrift
        .map(
          (d) =>
            `${d.exercise.name} at ${formatEffort(d.effort, d.exercise.tracking, unit)}: average RPE ${d.fromRpe} → ${d.toRpe}`,
        )
        .join('\n  ')}`,
    )
  }
  return sections
}

/**
 * An exercise's recent sessions, one line each, with the session's best estimated max for a weight
 * lift — `2026-10-14: w10 × 20 kg, 8 × 60 kg @ RPE 8.5 · estimated max 74 kg` — and its stall,
 * if it has one, last.
 */
export function historyLines(history: ExerciseHistory, unit: WeightUnit): string {
  if (history.sessions.length === 0) return 'No sessions logged for this exercise.'
  const estimates = new Map(
    pointsOf(history).flatMap((p) => (p.estimated ? [[p.sessionId, p.value] as const] : [])),
  )
  const lines = history.sessions.map((s) => {
    const sets = s.sets
      .map(
        (set) =>
          `${set.isWarmup ? 'w' : ''}${formatEffort(set, history.tracking, unit)}${atRpe(set.rpe)}`,
      )
      .join(', ')
    const estimate = estimates.get(s.sessionId)
    const max = estimate === undefined ? '' : ` · estimated max ${formatWeight(estimate, unit)}`
    return `${s.performedAt.slice(0, 10)}: ${sets}${max}`
  })
  const { stalled } = history
  return [
    ...lines,
    ...(stalled === null ? [] : [`Stalled: ${formatStall(stalled, history.tracking, unit)}`]),
  ].join('\n')
}

/**
 * `quadriceps: 12 sets, 1537.5 kg lifted (+20%)`. Work with no load — a plank, a run — is its sets
 * alone: it used to read "0 kg", as if the muscle had not been trained.
 */
function muscleLine(m: MuscleWork, unit: WeightUnit): string {
  const sets = `${m.weightedSets} set${m.weightedSets === 1 ? '' : 's'}`
  const lifted = m.liftedG === 0 ? '' : `, ${formatWeight(m.liftedG, unit)} lifted`
  const change =
    m.changePct === null ? 'no prior data' : `${m.changePct > 0 ? '+' : ''}${m.changePct}%`
  return `${m.muscle}: ${sets}${lifted} (${change})`
}

/**
 * The muscles the review chose, as it chose them: the most worked with a count of the rest, then
 * the declined ones under their own heading — or no heading at all when there are none.
 */
function muscleSections(
  work: TrainingReview['muscleWork'],
  weeks: number,
  unit: WeightUnit,
): string[] {
  // Empty only when no muscle was worked in either window: the rest are counted after the top.
  if (work.top.length === 0) return ['No working sets recorded.']
  const more =
    work.omitted === 0
      ? []
      : [`and ${work.omitted} more muscle${work.omitted === 1 ? '' : 's'} with less work.`]
  const sections = [
    `Working sets by muscle, by its share of each exercise (vs the preceding ${weeks} weeks):\n  ${[
      ...work.top.map((m) => muscleLine(m, unit)),
      ...more,
    ].join('\n  ')}`,
  ]
  if (work.declined.length > 0) {
    sections.push(
      `Declined sharply (half or less of their sets in the preceding ${weeks} weeks):\n  ${work.declined
        .map((m) => muscleLine(m, unit))
        .join('\n  ')}`,
    )
  }
  return sections
}

/**
 * The coaching summary. Lives here with its siblings rather than inline in the tool, because a tool
 * handler calls one service and formats the result — it does not BE the formatter.
 * See docs/07-mcp.md.
 */
export function reviewSummary(review: TrainingReview, unit: WeightUnit): string {
  const { weeks, adherence: a } = review

  const days =
    review.dayBalance.length === 0
      ? 'No sessions were tied to a planned day (all ad hoc).'
      : `Planned days trained:\n  ${review.dayBalance
          .map((d) => `${d.workout} / ${d.day}: ${d.sessions}x`)
          .join('\n  ')}`

  const stalled =
    review.stalled.length === 0
      ? 'Nothing looks stalled.'
      : `Stalled (the same top set, ${AT_LEAST_SESSIONS}+ sessions running):\n  ${review.stalled.map((s) => stalledLine(s, unit)).join('\n  ')}`

  return [
    `Last ${weeks} weeks: ${a.sessions} sessions (${a.perWeek}/week).`,
    a.lastSessionAt === null
      ? 'No sessions logged in this window.'
      : `Last session ${a.lastSessionAt}. Current streak ${a.currentStreakDays} days, longest gap ${a.longestGapDays} days.`,
    '',
    days,
    '',
    muscleSections(review.muscleWork, weeks, unit).join('\n\n'),
    '',
    stalled,
    ...deloadSections(review, unit).flatMap((section) => ['', section]),
  ].join('\n')
}
