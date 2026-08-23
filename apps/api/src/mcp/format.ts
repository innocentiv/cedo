import type { Exercise, ProgressionSuggestion, Workout, WorkoutSummary } from '@cedo/contract'
import { formatDistance, formatWeight } from '@cedo/contract'
import type { TrainingReview } from '../modules/review/service.ts'

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

const setLine = (set: Workout['days'][number]['entries'][number]['sets'][number]): string => {
  const parts: string[] = []
  if (set.target.reps !== null) parts.push(`${set.target.reps} reps`)
  if (set.target.weightG !== null) parts.push(formatWeight(set.target.weightG))
  if (set.target.durationS !== null) parts.push(`${set.target.durationS}s`)
  if (set.target.distanceMm !== null) parts.push(formatDistance(set.target.distanceMm))
  if (set.target.rpe !== null) parts.push(`RPE ${set.target.rpe}`)
  return `${set.isWarmup ? 'warm-up' : 'work'}: ${parts.join(' × ') || 'unspecified'}`
}

/** The whole plan as an outline. A 6-day plan is ~60 short lines rather than ~40 KB of JSON. */
export function workoutDetail(workout: Workout): string {
  const header = `${workout.name}  (${workout.id})${workout.canEdit ? '' : '  [read-only]'}`
  const notes = workout.notes === null ? [] : [`notes: ${workout.notes}`]

  const days = workout.days.map((day) => {
    const entries = day.entries.map((entry) => {
      const superset = entry.supersetGroup === null ? '' : ` (superset ${entry.supersetGroup})`
      const rest = entry.restSeconds === null ? '' : `, rest ${entry.restSeconds}s`
      const rule =
        entry.progression.kind === 'none' ? '' : `, progression: ${entry.progression.kind}`
      // Null when the caller cannot see the exercise — see the note on WorkoutEntry.exercise.
      const name = entry.exercise?.name ?? '[unavailable exercise]'
      return [
        `  - ${name}${superset}${rest}${rule}   [entry ${entry.id}]`,
        ...entry.sets.map((set) => `      ${setLine(set)}`),
      ].join('\n')
    })
    return [`Day ${day.index + 1}: ${day.name}`, ...entries].join('\n')
  })

  return [header, ...notes, '', ...days].join('\n')
}

export function suggestionLines(suggestions: readonly ProgressionSuggestion[]): string {
  if (suggestions.length === 0) return 'This workout has no entries yet.'

  return suggestions
    .map((s) => {
      const from = describeTarget(s.current)
      const to = describeTarget(s.suggested)
      const basis = `${s.sessionsConsidered} session${s.sessionsConsidered === 1 ? '' : 's'} of history`
      return s.changed
        ? `${s.exerciseName}: ${from} -> ${to}  (${s.rule.kind}, from ${basis})`
        : `${s.exerciseName}: hold at ${from}  (${s.rule.kind}, from ${basis})`
    })
    .join('\n')
}

function describeTarget(target: ProgressionSuggestion['current']): string {
  const parts: string[] = []
  if (target.reps !== null) parts.push(`${target.reps} reps`)
  // `formatWeight`, not a hand-rolled conversion: the two MCP outputs otherwise disagreed
  // (`62.5kg` here versus `62.5 kg` from setLine). See CLAUDE.md invariant 6.
  if (target.weightG !== null) parts.push(formatWeight(target.weightG))
  if (target.durationS !== null) parts.push(`${target.durationS}s`)
  return parts.join(' × ') || 'no target set'
}

/**
 * The coaching summary. Lives here with its siblings rather than inline in the tool, because a tool
 * handler calls one service and formats the result — it does not BE the formatter.
 * See docs/07-mcp.md.
 */
export function reviewSummary(review: TrainingReview, weeks: number): string {
  const a = review.adherence

  const days =
    review.dayBalance.length === 0
      ? 'No sessions were tied to a planned day (all ad hoc).'
      : `Planned days trained:\n  ${review.dayBalance
          .map((d) => `${d.workout} / ${d.day}: ${d.sessions}x`)
          .join('\n  ')}`

  const volume =
    review.muscleVolume.length === 0
      ? 'No working volume recorded.'
      : `Volume by muscle (vs the preceding ${weeks} weeks):\n  ${review.muscleVolume
          .slice(0, 12)
          .map((m) => {
            const change =
              m.changePct === null
                ? 'no prior data'
                : `${m.changePct > 0 ? '+' : ''}${m.changePct}%`
            return `${m.muscle}: ${m.volumeKg}kg (${change})`
          })
          .join('\n  ')}`

  const stalled =
    review.stalled.length === 0
      ? 'Nothing looks stalled.'
      : `Stalled (no improvement across 3+ sessions):\n  ${review.stalled
          .map(
            (s) =>
              `${s.exercise}: ${s.sessions} sessions at ${s.bestWeightKg ?? '?'}kg × ${s.bestReps ?? '?'}`,
          )
          .join('\n  ')}`

  return [
    `Last ${weeks} weeks: ${a.sessions} sessions (${a.perWeek}/week).`,
    a.lastSessionAt === null
      ? 'No sessions logged in this window.'
      : `Last session ${a.lastSessionAt}. Current streak ${a.currentStreakDays} days, longest gap ${a.longestGapDays} days.`,
    '',
    days,
    '',
    volume,
    '',
    stalled,
  ].join('\n')
}
