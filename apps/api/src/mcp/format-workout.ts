import type {
  AthleteEquipment,
  Load,
  ProgressionSuggestion,
  TrackingMode,
  WeightUnit,
  Workout,
  WorkoutSet,
  WorkoutSummary,
} from '@cedo/contract'
import {
  LOAD_LIMIT_WORDS,
  loadOf,
  loadable,
  MISSING_EQUIPMENT,
  describeProgression,
  formatEffort,
  formatWeight,
  formatWithReserve,
  heldWords,
  restPlace,
  restWords,
} from '@cedo/contract'
import { type GroupNameOf, ownership } from './format-group.ts'

/**
 * A plan and its progression as the model reads them (docs/07-mcp.md, "A plan teaches its own
 * model"): every rule in full, each set's reps in reserve, and the caller's own target beside the
 * prescription it started from (ADR-0026). Every effort goes through the contract's formatters, so
 * the AI reads a set exactly as the app shows it.
 */

/** A workout's flags, its line's and its outline's alike: `[mine]`, `[library, read-only]` (#47). */
const flagsOf = (workout: WorkoutSummary, groupNameOf: GroupNameOf): string =>
  `[${ownership(workout, groupNameOf).join(', ')}]`

export const workoutLine = (workout: WorkoutSummary, groupNameOf: GroupNameOf): string =>
  `${workout.name} | ${workout.dayCount} day${workout.dayCount === 1 ? '' : 's'}` +
  ` | ${flagsOf(workout, groupNameOf)} | ${workout.id}`

/** A rule as the editor says it: `Double 8–12, +2.5 kg`, `Linear, +0:15`, `Manual`. */
const ruleWords = (rule: ProgressionSuggestion['rule'], unit: WeightUnit): string =>
  describeProgression(rule, (grams) => formatWeight(grams, unit))

const setLine = (
  set: WorkoutSet,
  tracking: TrackingMode | null,
  unit: WeightUnit,
  load: Load | null,
): string =>
  `${set.isWarmup ? 'warm-up' : 'work'}: ${formatWithReserve(set.target, tracking, unit)}${loadsNote(set.target.weightG, load, unit)}`

/** ` (loads 22 kg)` beside a weight the athlete's equipment cannot load as written (#36). */
function loadsNote(weightG: number | null, load: Load | null, unit: WeightUnit): string {
  if (weightG === null) return ''
  const can = loadable(load, weightG)
  if (can.weightG === weightG) return ''
  const end = can.limit === null ? '' : `, ${LOAD_LIMIT_WORDS[can.limit]}`
  return ` (loads ${formatWeight(can.weightG, unit)}${end})`
}

/** A name or notes changed: the two lines that changed, not the whole plan, which did not. */
export function workoutUpdated(workout: Workout): string {
  const notes = workout.notes === null ? 'no notes' : `notes: ${workout.notes}`
  return `Updated workout ${workout.id} — "${workout.name}"\n${notes}`
}

/** The whole plan as an outline. A 6-day plan is ~60 short lines rather than ~40 KB of JSON. */
export function workoutDetail(
  workout: Workout,
  unit: WeightUnit,
  /** What the athlete it is read for has: a weight they cannot load as written says so (#36). */
  equipment: AthleteEquipment,
  groupNameOf: GroupNameOf,
  /** The caller's own targets — none when it is read for an athlete (docs/07-mcp.md). */
  targets: readonly ProgressionSuggestion[],
): string {
  const header = `${workout.name}  (${workout.id})  ${flagsOf(workout, groupNameOf)}`
  const notes = workout.notes === null ? [] : [`notes: ${workout.notes}`]
  const targetOf = new Map(targets.map((t) => [t.entryId, t]))

  const days = workout.days.map((day) => {
    const entries = day.entries.map((entry, at) => {
      const superset = entry.supersetGroup === null ? '' : ` (superset ${entry.supersetGroup})`
      // Where the logger counts it, not the bare field: A1's rest never runs within a round (#48).
      const rest = `, ${restWords(entry.restSeconds, restPlace(day.entries, at))}`
      const rule = `, progression: ${ruleWords(entry.progression, unit)}`
      // Null when the caller cannot see the exercise — see the note on WorkoutEntry.exercise.
      const name = entry.exercise?.name ?? '[unavailable exercise]'
      // Kept in the plan, still loggable — but the AI is told before it plans around it (#35).
      const kit = entry.exercise?.doable === false ? ` [${MISSING_EQUIPMENT}]` : ''
      const load = entry.exercise === null ? null : loadOf(entry.exercise, equipment, unit)
      const tracking = entry.exercise?.tracking ?? null
      // Said only where it differs: the plan's numbers are the target of anyone who has not moved.
      const target = targetOf.get(entry.id)
      const next =
        target?.changed === true
          ? [
              `      next: ${formatEffort(target.suggested, target.tracking, unit)} — your target; reps in reserve as each set asks`,
            ]
          : []
      return [
        `  - ${name}${kit}${superset}${rest}${rule}   [entry ${entry.id}]`,
        ...(entry.cue === null ? [] : [`      cue: ${entry.cue}`]),
        ...entry.sets.map((set) => `      ${setLine(set, tracking, unit, load)}`),
        ...next,
      ].join('\n')
    })
    // Its name, as the app shows a day: the outline's order is already its position, and a day
    // named the way people name them — "Day 1 · Push" — was said twice under a number of ours.
    return [day.name, ...entries].join('\n')
  })

  return [header, ...notes, '', ...days].join('\n')
}

/**
 * Each entry's next target for the caller, beside what the plan says, and why its latest step held,
 * per set (`heldWords`) — the logger's words. A manual entry is the plan's numbers. Reps in reserve
 * are not said: they are the plan's, set by set, which no rule moves — one number here read a ramp
 * of 2, 1, 0 as 2 for every set.
 */
export function suggestionLines(
  suggestions: readonly ProgressionSuggestion[],
  unit: WeightUnit,
): string {
  if (suggestions.length === 0) return 'This workout has no entries yet.'
  return suggestions.map((s) => suggestionLine(s, unit)).join('\n')
}

export function suggestionLine(s: ProgressionSuggestion, unit: WeightUnit): string {
  const plan = formatEffort(s.current, s.tracking, unit)
  const head = `${s.exerciseName} (${ruleWords(s.rule, unit)})`
  if (s.rule.kind === 'none') {
    return `${head}: ${plan}, the plan’s numbers — change the plan to change them`
  }
  const next = formatEffort(s.suggested, s.tracking, unit)
  const target = s.changed
    ? `next ${next}; the plan says ${plan}`
    : `next ${next}, as the plan says`
  const why = s.held === null ? '' : ` — ${heldWords(s.held, s.tracking, unit)}`
  const n = s.sessionsConsidered
  const basis = n === 0 ? 'no session yet' : `from ${n} session${n === 1 ? '' : 's'}`
  return `${head}: ${target}${why}  (${basis})`
}
