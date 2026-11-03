import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import {
  type Against,
  type Held,
  type LoadFor,
  type SetTarget,
  againstOf,
  nextLoadableStep,
  prescriptionIn,
  stillCounts,
} from '@cedo/contract'
import type { Transaction } from '../../db/client.ts'
import { progressionSteps, setLogs, workoutSessions } from '../../db/schema.ts'
import { groupBy } from '../../lib/keyset.ts'
import type { Caller } from '../../plugins/auth.ts'
import { loadsOf } from '../equipment/held.ts'
import { finishedLogs, ruledEntries, stepsOf } from './step-rows.ts'

/**
 * Taking a person's steps (ADR-0026): the one write that moves a target, called when a session is
 * finished or logged whole, and when one is corrected or deleted — in that write's transaction.
 *
 * Every step of the entries from `from` onward is taken again, in the order training happened: each
 * finished session judged against the plan as it stood when its step was first taken (stored on the
 * step), or as it stands now for a session not judged before. A step set by hand stays where it is
 * in time, and what follows is judged from it. A person's steps are taken one write at a time, under
 * a lock of their own, so a correction and a finish cannot interleave.
 */
export async function retakeSteps(
  tx: Transaction,
  caller: Caller,
  entryIds: readonly string[],
  from: Date,
  loadFor: LoadFor,
): Promise<void> {
  if (entryIds.length === 0) return
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`steps:${caller.userId}`}, 0))`,
  )

  const entries = await ruledEntries(tx, caller, entryIds)
  if (entries.length === 0) return
  const ids = entries.map((e) => e.id)
  const [steps, logs] = await Promise.all([
    stepsOf(tx, caller, ids),
    finishedLogs(tx, caller, ids, from),
  ])

  await tx
    .delete(progressionSteps)
    .where(
      and(
        eq(progressionSteps.userId, caller.userId),
        inArray(progressionSteps.entryId, ids),
        eq(progressionSteps.kind, 'session'),
        gte(progressionSteps.takenAt, from),
      ),
    )

  const stepsByEntry = groupBy(steps, (s) => s.entryId)
  const logsByEntry = groupBy(logs, (l) => l.entryId)
  const taken = entries.flatMap((entry) =>
    retaken(
      entry,
      stepsByEntry.get(entry.id) ?? [],
      logsByEntry.get(entry.id) ?? [],
      from,
      loadFor,
    ),
  )
  if (taken.length === 0) return
  await tx
    .insert(progressionSteps)
    .values(taken.map((s) => Object.assign(s, { userId: caller.userId, kind: 'session' as const })))
}

/** Which entries a session of the caller's trained, and when it started: what its steps cover. */
export async function stepScopeOf(
  tx: Transaction,
  caller: Caller,
  sessionId: string,
): Promise<StepScope | null> {
  const [session] = await tx
    .select({ startedAt: workoutSessions.startedAt })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, caller.userId), eq(workoutSessions.id, sessionId)))
    .limit(1)
  if (session === undefined) return null
  const trained = await tx
    .selectDistinct({ entryId: setLogs.entryId })
    .from(setLogs)
    .where(and(eq(setLogs.sessionId, sessionId), isNotNull(setLogs.entryId)))
  return {
    entryIds: trained.flatMap((t) => (t.entryId === null ? [] : [t.entryId])),
    startedAt: session.startedAt,
  }
}

/**
 * The steps of everything a session of the caller's trained, taken again from its start: when it
 * is finished, logged whole, or one of its sets corrected or removed. In the caller's transaction.
 */
export async function retakeStepsOf(
  tx: Transaction,
  caller: Caller,
  sessionId: string,
): Promise<void> {
  await retakeStepsIn(tx, caller, await stepScopeOf(tx, caller, sessionId))
}

/** The steps a scope covers, taken again — read before the session it came from was deleted. */
export async function retakeStepsIn(
  tx: Transaction,
  caller: Caller,
  scope: StepScope | null,
): Promise<void> {
  if (scope === null) return
  const loadFor = await loadsOf(caller.userId, caller.weightUnit)
  await retakeSteps(tx, caller, scope.entryIds, scope.startedAt, loadFor)
}

/** What a session's steps cover: the entries it trained, from its start. */
export interface StepScope {
  readonly entryIds: string[]
  readonly startedAt: Date
}

type Entry = Awaited<ReturnType<typeof ruledEntries>>[number]
type Step = Awaited<ReturnType<typeof stepsOf>>[number]
type Log = Awaited<ReturnType<typeof finishedLogs>>[number]

/** A step as taken: what the session was asked, what it left, and what it was judged against. */
interface Taken {
  readonly entryId: string
  readonly sessionId: string
  readonly takenAt: Date
  readonly from: SetTarget
  readonly target: SetTarget
  readonly held: Held | null
  readonly streak: number
  readonly against: Against
}

/**
 * One entry's steps from `from` onward, taken again: the sessions and the steps set by hand since,
 * in the order they happened, each session a step from wherever the last one left the target.
 */
function retaken(
  entry: Entry,
  steps: readonly Step[],
  logs: readonly Log[],
  from: Date,
  loadFor: LoadFor,
): Taken[] {
  const now = againstOf(entry.progression, entry.working)
  const judgedAgainst = new Map(
    steps.flatMap((s) =>
      s.sessionId !== null && s.takenAt >= from ? [[s.sessionId, s.against]] : [],
    ),
  )
  const timeline: ({ at: Date; byHand: Step } | { at: Date; sets: Log[] })[] = [
    ...steps
      .filter((s) => s.kind === 'by_hand' && s.takenAt >= from)
      .map((s) => ({ at: s.takenAt, byHand: s })),
    ...[...groupBy(logs, (l) => l.sessionId).values()].flatMap((sets) => {
      const [first] = sets
      return first === undefined ? [] : [{ at: first.startedAt, sets }]
    }),
  ].toSorted((a, b) => a.at.getTime() - b.at.getTime())

  let base: Pick<Taken, 'target' | 'streak' | 'against'> | null =
    steps.findLast((s) => s.takenAt < from) ?? null
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
  entry: Entry,
  sets: readonly Log[],
  base: Pick<Taken, 'target' | 'streak' | 'against'> | null,
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
