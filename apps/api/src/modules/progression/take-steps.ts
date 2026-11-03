import {
  type Against,
  type Held,
  type LoadFor,
  type LoadedExercise,
  type Progression,
  type SetAttempt,
  type SetTarget,
  type StepKind,
  againstOf,
  nextLoadableStep,
  prescriptionIn,
  stillCounts,
} from '@cedo/contract'
import { groupBy } from '../../lib/keyset.ts'

/**
 * Taking steps, apart from their storage: rows in, steps out, no database (ADR-0026). The rules'
 * maths is the contract's `step`; what is here is the order — training's — and what each session
 * is judged from and against. `write-steps.ts` reads the rows and writes what this returns.
 */

/** An entry the caller can see: its rule, its WORKING sets in order, and its exercise's load. */
export interface RuledEntry extends LoadedExercise {
  readonly id: string
  readonly progression: Progression
  readonly working: readonly {
    readonly targetReps: number | null
    readonly targetWeightG: number | null
    readonly targetReserve: number | null
    readonly targetDurationS: number | null
    readonly targetDistanceMm: number | null
  }[]
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

type Base = Pick<Taken, 'target' | 'streak' | 'against'>

/**
 * One entry's steps from `from` onward, taken again: the sessions and the steps set by hand since,
 * in the order they happened, each session a step from wherever the last one left the target. A
 * session already judged is judged against the plan as it stood then (its stored `against`); one
 * not judged before, against the plan as it stands. A step set by hand stays, and anchors.
 */
export function retaken(
  entry: RuledEntry,
  steps: readonly StoredStep[],
  sets: readonly FinishedSet[],
  from: Date,
  loadFor: LoadFor,
): Taken[] {
  const now = againstOf(entry.progression, entry.working)
  const judgedAgainst = new Map(
    steps.flatMap((s) =>
      s.sessionId !== null && s.takenAt >= from ? [[s.sessionId, s.against]] : [],
    ),
  )
  const timeline: ({ at: Date; byHand: StoredStep } | { at: Date; sets: FinishedSet[] })[] = [
    ...steps
      .filter((s) => s.kind === 'by_hand' && s.takenAt >= from)
      .map((s) => ({ at: s.takenAt, byHand: s })),
    ...[...groupBy(sets, (l) => l.sessionId).values()].flatMap((session) => {
      const [first] = session
      return first === undefined ? [] : [{ at: first.startedAt, sets: session }]
    }),
  ].toSorted((a, b) => a.at.getTime() - b.at.getTime())

  let base: Base | null = steps.findLast((s) => s.takenAt < from) ?? null
  const taken: Taken[] = []
  for (const event of timeline) {
    if ('byHand' in event) {
      base = event.byHand
      continue
    }
    const step = sessionStep(entry, event.sets, base, judgedAgainst, now, loadFor)
    if (step === null) continue
    taken.push(step)
    base = step
  }
  return taken
}

/**
 * One session's step, from wherever the last step left the target — while that step still counts
 * against the plan as it stood for this session, else from that plan's prescription. Null under no
 * rule: a manual entry takes no steps.
 */
function sessionStep(
  entry: RuledEntry,
  sets: readonly FinishedSet[],
  base: Base | null,
  judgedAgainst: ReadonlyMap<string, Against>,
  now: Against,
  loadFor: LoadFor,
): Taken | null {
  const [first] = sets
  if (first === undefined) return null
  const against = judgedAgainst.get(first.sessionId) ?? now
  if (against.rule.kind === 'none') return null
  const start =
    base !== null && stillCounts(base.against, against)
      ? base
      : { target: prescriptionIn(against), streak: 0 }
  const stepped = nextLoadableStep(
    {
      rule: against.rule,
      target: start.target,
      workingSets: against.reserves.length,
      reserves: against.reserves,
      streak: start.streak,
      session: sets,
    },
    loadFor(entry),
  )
  return {
    entryId: entry.id,
    sessionId: first.sessionId,
    takenAt: first.startedAt,
    from: stepped.shown,
    target: stepped.target,
    held: stepped.held,
    streak: stepped.streak,
    against,
  }
}
