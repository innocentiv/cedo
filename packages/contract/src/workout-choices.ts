import type { Effort } from './effort.ts'
import type { FlowLog } from './session-flow.ts'

/**
 * What the athlete chose on the workout screen (GLOSSARY.md, "Focus"), and how what they do there
 * changes it (`choicesAfter`). The screen holds it; `workoutView` reads it.
 */

/** A set as it is undone: what it was of, and what it said. */
type UndoneLog = FlowLog & { readonly exerciseId: string; readonly reserve: number | null }

/**
 * A set just undone (#63): of a plan entry or of an exercise logged with none, and what it said.
 * Its entry takes the focus, and the logger starts from what the set said, not from the target: one
 * wrong number is fixed, and the set logged again.
 */
export interface Undone {
  readonly entryId: string | null
  readonly exerciseId: string
  readonly effort: Effort
  readonly reserve: number | null
}

/** A set as it is undone: what it was of, and what it said. */
export const undoneOf = (log: UndoneLog): Undone => ({
  entryId: log.entryId,
  exerciseId: log.exerciseId,
  effort: {
    reps: log.reps,
    weightG: log.weightG,
    durationS: log.durationS,
    distanceMm: log.distanceMm,
  },
  reserve: log.reserve,
})

/** An entry of the day, or an exercise logged with none, put in focus. */
export type Chosen = { readonly entry: string } | { readonly added: string }

/**
 * What the athlete chose: an entry of the day or an exercise logged with none, put in focus, and a
 * set undone — which chooses its own entry, unless something is chosen after it.
 */
export interface WorkoutChoices {
  readonly chosen: Chosen | null
  readonly undone: Undone | null
}

export const NO_CHOICES: WorkoutChoices = { chosen: null, undone: null }

/** What the athlete does on the workout screen that changes what they chose. */
export type ChoiceEvent =
  /** An entry tapped in Up next, an exercise among those added, or "+ set" on an entry. */
  | { readonly kind: 'tapped'; readonly chosen: Chosen }
  /** Exercises picked into the session, in the order picked (#27). */
  | { readonly kind: 'picked'; readonly exercises: readonly { readonly id: string }[] }
  | { readonly kind: 'pickerOpened' }
  /** A set logged on this device; one logged elsewhere — over MCP — changes nothing. */
  | { readonly kind: 'logged' }
  | { readonly kind: 'undone'; readonly set: UndoneLog }

/**
 * What the athlete chose, after what they did — the one rule of it (GLOSSARY.md, "Focus"):
 *
 * - **Tapped**: chosen, over anything chosen before; a set undone stays undone.
 * - **Picked**: the first exercise picked is chosen, so it takes the focus as a tap would.
 * - **Picker opened**: what was chosen is forgotten — what is picked takes the focus.
 * - **Logged**: everything is forgotten. The next set is what ends a choice — by what this device
 *   did, never by which set is latest: a set logged without a signal changes id when the server has
 *   it, and a choice held to its id was lost as it landed.
 * - **Undone**: the set is held, which chooses its own entry (#63), and replaces any other.
 */
export function choicesAfter(held: WorkoutChoices, event: ChoiceEvent): WorkoutChoices {
  switch (event.kind) {
    case 'tapped':
      return { ...held, chosen: event.chosen }
    case 'picked': {
      const [first] = event.exercises
      return first === undefined ? held : { ...held, chosen: { added: first.id } }
    }
    case 'pickerOpened':
    case 'logged':
      return NO_CHOICES
    case 'undone':
      return { chosen: null, undone: undoneOf(event.set) }
    default:
      return event satisfies never
  }
}
