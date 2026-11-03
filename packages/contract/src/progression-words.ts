import { formatEffort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import type { Held, Progression, SetTarget } from './progression.ts'
import { formatReserve } from './rpe.ts'
import { unhandledKind } from './stored-rule.ts'
import { type WeightUnit, formatDistance, formatDuration } from './units.ts'

/**
 * Human-readable rule summary. Lives in the contract so screens never format domain concepts
 * themselves. The rules themselves are progression.ts.
 */
export function describeProgression(
  rule: Progression,
  formatIncrement: (grams: number) => string,
): string {
  switch (rule.kind) {
    case 'none':
      return 'Manual'
    case 'linear':
      return `Linear, +${formatIncrement(rule.incrementG)}${streak(rule.afterSuccesses)}`
    case 'linear_duration':
      return `Linear, +${formatDuration(rule.incrementS)}${streak(rule.afterSuccesses)}`
    case 'linear_distance':
      return `Distance, +${formatDistance(rule.incrementMm)} at the same pace${streak(rule.afterSuccesses)}`
    case 'double': {
      const [min, max] = rule.repRange
      return `Double ${min}–${max}, +${formatIncrement(rule.incrementG)}`
    }
    default:
      return unhandledKind(rule)
  }
}

/**
 * How many sessions in a row must clear a prescription before the rule advances it, said only when
 * it waits for more than one.
 */
const streak = (afterSuccesses: number): string =>
  afterSuccesses === 1 ? '' : ` after ${afterSuccesses} cleared sessions`

/**
 * Why a step held, per set (ADR-0026): `held: set 3 did 7 of 10`, short of the reps alone;
 * `held: set 2 did 8 × 50 kg of 8 × 55 kg`, short of anything else; `held: set 3 not done`; or
 * `held for effort: set 3 left 0 in reserve, asked 2`. What `workout_progression` says, and the
 * logger beside the target — so the AI and the athlete read a hold in the same words.
 */
export function heldWords(held: Held, tracking: TrackingMode, unit: WeightUnit): string {
  if (held.reason === 'effort') {
    return `held for effort: set ${held.set} left ${formatReserve(held.reserve)} in reserve, asked ${formatReserve(held.asked)}`
  }
  const { did, asked } = held
  if (did === null) return `held: set ${held.set} not done`
  if (onlyRepsDiffer(did, asked)) return `held: set ${held.set} did ${did.reps} of ${asked.reps}`
  return `held: set ${held.set} did ${formatEffort(did, tracking, unit)} of ${formatEffort(asked, tracking, unit)}`
}

/** The set did what it was asked in everything but its reps — its reserve aside, judged apart. */
const onlyRepsDiffer = (did: SetTarget, asked: SetTarget): boolean =>
  did.reps !== null &&
  asked.reps !== null &&
  did.weightG === asked.weightG &&
  did.durationS === asked.durationS &&
  did.distanceMm === asked.distanceMm

/**
 * What a rule does, as one plain sentence — said under the rule in the entry editor, so picking it
 * says what it will do (docs/08-frontend.md, "An entry's settings"). Manual says what moves nothing.
 */
export function ruleSentence(
  rule: Progression,
  formatIncrement: (grams: number) => string,
): string {
  switch (rule.kind) {
    case 'none':
      return 'Nothing moves these numbers but an edit to the plan.'
    case 'double': {
      const [from, to] = rule.repRange
      return `Climb from ${from} to ${to} reps at the same weight. When every working set reaches ${to}, add ${formatIncrement(rule.incrementG)} and start again at ${from}.`
    }
    case 'linear':
      return `Add ${formatIncrement(rule.incrementG)} when every working set makes its reps, leaving the reps in reserve it asks${running(rule.afterSuccesses)}.`
    case 'linear_duration':
      return `Add ${formatDuration(rule.incrementS)} when every working set lasts its time${running(rule.afterSuccesses)}.`
    case 'linear_distance':
      return `Go ${formatDistance(rule.incrementMm)} further at the same pace when every working set covers its distance in its time${running(rule.afterSuccesses)}.`
    default:
      return unhandledKind(rule)
  }
}

/** `, 2 sessions running` — said only when a rule waits for more than one cleared session. */
const running = (afterSuccesses: number): string =>
  afterSuccesses === 1 ? '' : `, ${afterSuccesses} sessions running`
