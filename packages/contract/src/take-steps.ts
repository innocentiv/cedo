import {
  type Against,
  type PrescribedWorkingSet,
  type StepKind,
  againstOf,
  prescriptionIn,
  stillCounts,
} from './against.ts'
import { type Load, loadable, steppedOn } from './load.ts'
import { loadableTarget } from './loadable-target.ts'
import type { Held, Progression, SetAttempt, SetTarget } from './progression.ts'
import { step } from './step.ts'

/**
 * Taking steps, apart from their storage: rows in, steps out, no database (ADR-0026). The rules'
 * maths is `step`'s, reached only from here; what is here is the order — training's — what each
 * session is judged from and against, and the weights it lands on (ADR-0024). The API's
 * `write-steps.ts` reads the rows and writes what this returns.
 */

/** An entry the caller can see: its rule, and its WORKING sets in order. */
export interface RuledEntry {
  readonly id: string
  readonly progression: Progression
  readonly working: readonly PrescribedWorkingSet[]
}

/** One of the caller's steps on the entry, as stored. */
export interface StoredStep {
  readonly sessionId: string | null
  readonly kind: StepKind
  readonly takenAt: Date
  readonly target: SetTarget
  readonly streak: number
  readonly against: Against
}

/** One of the caller's sets against the entry, in a finished session. */
export interface FinishedSet extends SetAttempt {
  readonly sessionId: string
  readonly startedAt: Date
}

/** A step as taken: what the session was asked, what it left, and what it was judged against. */
export interface Taken {
  readonly entryId: string
  readonly sessionId: string
  readonly takenAt: Date
  readonly from: SetTarget
  readonly target: SetTarget
  readonly held: Held | null
  readonly streak: number
  readonly against: Against
}

/** The step the next session steps from: the last one taken, one stored, or one set by hand. */
type Previous = Pick<Taken, 'target' | 'streak' | 'against'>

/**
 * One entry's steps from `from` onward, taken: the sessions and the steps set by hand since, in the
 * order they happened, each session a step from wherever the last one left the target. A session
 * already judged is judged against the plan as it stood then (its stored `against`); one not judged
 * before, against the plan as it stands. A step set by hand stays, and anchors. `load` is what the
 * person's equipment puts on the entry's exercise, or null when it is not known.
 */
export function takeSteps(
  entry: RuledEntry,
  steps: readonly StoredStep[],
  sets: readonly FinishedSet[],
  from: Date,
  load: Load | null,
): Taken[] {
  const asItStands = againstOf(entry.progression, entry.working)
  const judgedAgainst = new Map(
    steps.flatMap((s) =>
      s.sessionId !== null && s.takenAt >= from ? [[s.sessionId, s.against]] : [],
    ),
  )
  const timeline: ({ at: Date; byHand: StoredStep } | { at: Date; sets: FinishedSet[] })[] = [
    ...steps
      .filter((s) => s.kind === 'by_hand' && s.takenAt >= from)
      .map((s) => ({ at: s.takenAt, byHand: s })),
    ...[...bySession(sets).values()].flatMap((session) => {
      const [first] = session
      return first === undefined ? [] : [{ at: first.startedAt, sets: session }]
    }),
  ].toSorted((a, b) => a.at.getTime() - b.at.getTime())

  let previous: Previous | null = steps.findLast((s) => s.takenAt < from) ?? null
  const taken: Taken[] = []
  for (const moment of timeline) {
    if ('byHand' in moment) {
      previous = moment.byHand
      continue
    }
    const next = sessionStep(entry, moment.sets, previous, judgedAgainst, asItStands, load)
    if (next === null) continue
    taken.push(next)
    previous = next
  }
  return taken
}

/** The sets of each session, in the order they came. */
function bySession(sets: readonly FinishedSet[]): Map<string, FinishedSet[]> {
  const sessions = new Map<string, FinishedSet[]>()
  for (const set of sets) {
    const session = sessions.get(set.sessionId)
    if (session === undefined) sessions.set(set.sessionId, [set])
    else session.push(set)
  }
  return sessions
}

/**
 * One session's step, from wherever the last step left the target — while that step still counts
 * against the plan as it stood for this session, else from that plan's prescription. Null under no
 * rule: a manual entry takes no steps.
 *
 * In weights the athlete can load: the session is judged against the target as they were shown it
 * — a 22.5 kg plan logged as 22 on 2 kg dumbbells is met, not missed — and an advance is added to
 * THAT weight (`fitted`), so the step keeps a weight their equipment could load the day it was taken.
 */
function sessionStep(
  entry: RuledEntry,
  sets: readonly FinishedSet[],
  previous: Previous | null,
  judgedAgainst: ReadonlyMap<string, Against>,
  asItStands: Against,
  load: Load | null,
): Taken | null {
  const [first] = sets
  if (first === undefined) return null
  const against = judgedAgainst.get(first.sessionId) ?? asItStands
  if (against.rule.kind === 'none') return null
  const start =
    previous !== null && stillCounts(previous.against, against)
      ? previous
      : { target: prescriptionIn(against), streak: 0 }
  const shown = loadableTarget(load, start.target).target
  const stepped = step({
    rule: against.rule,
    target: shown,
    workingSets: against.reserves.length,
    reserves: against.reserves,
    streak: start.streak,
    session: sets,
  })
  return {
    entryId: entry.id,
    sessionId: first.sessionId,
    takenAt: first.startedAt,
    from: shown,
    target: fitted(load, shown, stepped.target),
    held: stepped.held,
    streak: stepped.streak,
    against,
  }
}

/**
 * `next` in a weight the athlete can load, moved on from the target as they were shown it. When the
 * rule adds weight, it is the heaviest they have that is not above what the rule asks, but always
 * one weight up at least: a 1 kg increase on 2 kg dumbbells moves 22 to 24, where stepping down
 * would hold it there for good, and double progression would climb its reps forever. At their
 * heaviest already, one up is the heaviest: there it stays.
 */
function fitted(load: Load | null, shown: SetTarget, next: SetTarget): SetTarget {
  // Its weight held, it is the weight shown, though its reps may have climbed.
  if (next.weightG === shown.weightG) return next
  if (load === null || next.weightG === null || shown.weightG === null) {
    return loadableTarget(load, next).target
  }
  const up = steppedOn(load, shown.weightG, 1)
  return { ...next, weightG: Math.max(loadable(load, next.weightG).weightG, up) }
}
