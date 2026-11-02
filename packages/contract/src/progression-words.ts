import { type Progression, normaliseRange, unhandledKind } from './progression.ts'
import { formatDistance, formatDuration } from './units.ts'

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
      const [min, max] = normaliseRange(rule.repRange)
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
