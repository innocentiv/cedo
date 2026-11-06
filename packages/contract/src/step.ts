import { type Verdict, judgeDistance, judgeDuration, judgeReps, working } from './clears.ts'
import { type Held, type Progression, type SessionAttempts, SetTarget } from './progression.ts'
import { unhandledKind } from './stored-rule.ts'

/**
 * One finished session judged against the target it was asked (ADR-0026) — what a step is taken
 * from. The rule runs once per session, against the person's target, never against the plan.
 */
export interface StepInput {
  readonly rule: Progression
  /** What the session was asked: the person's target, in a weight they could load. */
  readonly target: SetTarget
  /** How many WORKING sets the entry prescribes. Warm-ups do not count. */
  readonly workingSets: number
  /**
   * The reps in reserve each working set asks, in set order (ADR-0026: effort ramps across sets,
   * and each set is judged against its own). Omitted, every working set asks the target's.
   */
  readonly reserves?: readonly (number | null)[]
  /** Sessions cleared in a row toward the rule's `afterSuccesses`, before this one. */
  readonly streak: number
  /** The session's sets, warm-ups included: they are dropped before anything is judged. */
  readonly session: SessionAttempts
}

/** What a step answers: the next target, why it held if something did, and the streak it leaves. */
export interface Stepped {
  readonly target: SetTarget
  readonly held: Held | null
  readonly streak: number
}

/**
 * Take one step: the next target from what one finished session did to the target it was asked.
 * Pure, total and deterministic — the single implementation, reached only through `takeSteps`
 * (take-steps.ts), once for each session it takes a step for; everything that shows a target reads
 * what it stored. Not part of the contract's surface, and tested through `takeSteps`.
 *
 * It ADVANCES OR HOLDS, never decreases. Deloading is a judgement call needing context this
 * function does not have (illness, a bad week, form breakdown), so it stays with the user or the
 * AI, acting through `workout_save_plan`.
 *
 * At a target's ceiling it holds: a target past what one may be would be refused by the API's own
 * response schema, failing the plan's whole progression and the logger's pre-fill.
 */
export function step(input: StepInput): Stepped {
  const next = advance(input)
  return SetTarget.safeParse(next.target).success
    ? next
    : { target: input.target, held: null, streak: 0 }
}

/** A target nothing held: advanced, or with nothing to hold it for — and no streak to carry. */
const unheld = (target: SetTarget): Stepped => ({ target, held: null, streak: 0 })

function advance(input: StepInput): Stepped {
  const { rule } = input
  switch (rule.kind) {
    case 'none':
      return unheld(input.target)
    case 'linear':
      return afterRun(
        rule.afterSuccesses,
        input,
        judged(input, (s) => judgeReps(s, input.target.reps, input.target, reservesOf(input))),
        addWeight(input.target, rule.incrementG),
      )
    case 'linear_duration':
      return afterRun(
        rule.afterSuccesses,
        input,
        judged(input, (s) => judgeDuration(s, input.target, input.workingSets)),
        addTime(input.target, rule.incrementS),
      )
    case 'linear_distance':
      return afterRun(
        rule.afterSuccesses,
        input,
        judged(input, (s) => judgeDistance(s, input.target, input.workingSets)),
        addDistance(input.target, rule.incrementMm),
      )
    case 'double':
      return advanceDouble(rule, input)
    default:
      return unhandledKind(rule)
  }
}

type RuleOf<K extends Progression['kind']> = Extract<Progression, { kind: K }>

/** The reserve each working set asks, in set order: its own, or — not given — the target's. */
const reservesOf = ({ target, workingSets, reserves }: StepInput): (number | null)[] =>
  Array.from({ length: workingSets }, (_, i) =>
    reserves === undefined ? target.reserve : (reserves[i] ?? null),
  )

/** The session's verdict: short at its first set when it did no working set at all. */
const judged = (input: StepInput, judge: (sets: SessionAttempts) => Verdict): Verdict =>
  judge(working(input.session) ?? [])

/**
 * A linear rule's step: held, with its reason, and the streak broken; cleared, one more in the
 * streak — and once it reaches `afterSuccesses`, the target advances and the streak starts over.
 */
function afterRun(
  afterSuccesses: number,
  input: StepInput,
  verdict: Verdict,
  advanced: SetTarget,
): Stepped {
  if (verdict !== 'cleared') return { target: input.target, held: verdict, streak: 0 }
  const streak = input.streak + 1
  return streak >= afterSuccesses ? unheld(advanced) : { target: input.target, held: null, streak }
}

const addWeight = (target: SetTarget, incrementG: number): SetTarget =>
  target.weightG === null ? target : { ...target, weightG: target.weightG + incrementG }

const addTime = (target: SetTarget, incrementS: number): SetTarget =>
  target.durationS === null ? target : { ...target, durationS: target.durationS + incrementS }

/**
 * Further, at the prescribed pace: the time grows in proportion, to whole seconds rounded up —
 * rounded down, it would ask for a hair faster than the pace.
 */
function addDistance(target: SetTarget, incrementMm: number): SetTarget {
  if (target.distanceMm === null) return target
  const distanceMm = target.distanceMm + incrementMm
  const durationS =
    target.durationS === null
      ? null
      : Math.ceil((target.durationS * distanceMm) / target.distanceMm)
  return { ...target, distanceMm, durationS }
}

function advanceDouble(rule: RuleOf<'double'>, input: StepInput): Stepped {
  const { target } = input
  const [minReps, maxReps] = rule.repRange
  const currentReps = target.reps ?? minReps
  const atTop = currentReps >= maxReps

  // Every working set asked for the top of the range when at it, else the current target.
  const goal = atTop ? maxReps : currentReps
  const verdict = judged(input, (s) => judgeReps(s, goal, target, reservesOf(input)))
  if (verdict !== 'cleared') return { target, held: verdict, streak: 0 }

  // Cleared the top of the range: add weight, restart at the bottom.
  if (atTop) {
    if (target.weightG === null) return unheld(target)
    return unheld({ ...target, reps: minReps, weightG: target.weightG + rule.incrementG })
  }

  // Met the current target: climb one rep.
  return unheld({ ...target, reps: currentReps + 1 })
}
