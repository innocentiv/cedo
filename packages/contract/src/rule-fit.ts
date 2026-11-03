import type { TrackingMode } from './exercise.ts'
import type { Progression } from './progression.ts'

type Kind = Progression['kind']

/**
 * Which progression rules fit an exercise, by how it is measured (ADR-0026, #22). A rule that moves
 * a dimension the exercise never logs — double on a plank, distance on a squat — can never advance.
 * The one answer the plan save, the editor and MCP all ask; in the order the editor offers them.
 */
const RULES: Record<TrackingMode, readonly Kind[]> = {
  weight_reps: ['none', 'linear', 'double'],
  bodyweight_reps: ['none', 'linear', 'double'],
  duration: ['none', 'linear_duration'],
  distance_duration: ['none', 'linear_distance'],
}

/** What an exercise of each mode is called, in a refusal. */
const MODE_WORDS: Record<TrackingMode, string> = {
  weight_reps: 'A weight lift',
  bodyweight_reps: 'A bodyweight movement',
  duration: 'A timed exercise',
  distance_duration: 'A distance exercise',
}

/** Each rule as a refusal names it, with what it moves where that says which to pick. */
const RULE_WORDS: Record<Kind, { readonly name: string; readonly offered: string }> = {
  none: { name: 'Manual', offered: 'Manual' },
  linear: { name: 'linear', offered: 'linear (adds weight)' },
  double: { name: 'double', offered: 'double' },
  linear_duration: { name: 'linear duration', offered: 'linear duration (adds seconds)' },
  linear_distance: { name: 'distance', offered: 'distance (further, at the same pace)' },
}

/** The rules that fit an exercise measured this way. */
export const rulesFor = (tracking: TrackingMode): readonly Kind[] => RULES[tracking]

/**
 * Why a rule does not fit an exercise measured this way, saying which do — or null when it fits.
 * Said to a person in the editor and to an AI through MCP, so it names what to pick instead.
 */
export function ruleMisfit(kind: Kind, tracking: TrackingMode): string | null {
  const fits = RULES[tracking]
  if (fits.includes(kind)) return null
  const offered = fits.map((k) => RULE_WORDS[k].offered)
  const list =
    offered.length <= 2
      ? offered.join(' or ')
      : `${offered.slice(0, -1).join(', ')} or ${offered.at(-1) ?? ''}`
  return `${MODE_WORDS[tracking]} takes ${list}, not ${RULE_WORDS[kind].name}`
}
