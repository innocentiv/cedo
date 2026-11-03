import type { ExerciseHistory, WeightUnit, MuscleWork, TrainingReview } from '@cedo/contract'
import {
  AT_LEAST_SESSIONS,
  driftLine,
  estimatedMax,
  formatEffort,
  formatStall,
  formatWeight,
  inReserve,
  pointsOf,
} from '@cedo/contract'
import { DRIFT_RESERVE, DRIFT_SESSIONS, FALLING_SESSIONS } from '../modules/review/service.ts'
import { aboutLine } from './format-file.ts'

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

/**
 * `Bench Press: 4 sessions at 8 × 60 kg` — the top set those sessions share, in its exercise's own
 * terms, like every other effort here: no unit arithmetic of its own.
 */
function stalledLine(s: TrainingReview['stalled'][number], unit: WeightUnit): string {
  const estimate = estimatedMax(
    { ...s.effort, reserve: s.effort.reserve ?? null },
    s.exercise.tracking,
  )
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
      `Effort drift (reps in reserve down ${DRIFT_RESERVE}+ at the same set, in each of the latest ${DRIFT_SESSIONS} sessions):\n  ${review.effortDrift
        .map((d) => `${d.exercise.name} at ${driftLine(d, unit)}`)
        .join('\n  ')}`,
    )
  }
  return sections
}

/**
 * An exercise's recent sessions, one line each, with the session's best estimated max for a weight
 * lift — `2026-10-14: w10 × 20 kg, 8 × 60 kg · 1 in reserve · estimated max 76 kg` — and its stall,
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
          `${set.isWarmup ? 'w' : ''}${formatEffort(set, history.tracking, unit)}${inReserve(set.reserve)}`,
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
    aboutLine(review, unit),
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
