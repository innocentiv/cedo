import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import type { Against, SetTarget } from '@cedo/contract'
import type { Transaction } from '../../db/client.ts'
import { progressionSteps } from '../../db/schema.ts'
import { groupBy } from '../../lib/keyset.ts'
import type { Caller } from '../../plugins/auth.ts'
import { loadsOf } from '../equipment/held.ts'
import { finishedSets, ruledEntries, stepsOf } from './step-rows.ts'
import { retaken } from './take-steps.ts'

/**
 * The statements that write a person's steps (ADR-0026), each in the caller's transaction and
 * under the person's step lock. What to write is `take-steps.ts`'s; what to read, `step-rows.ts`'s.
 */

/** What a session's steps cover: the entries it trained, from its start. */
export interface StepScope {
  readonly entryIds: readonly string[]
  readonly startedAt: Date
}

/**
 * Every step of a scope's entries from its start, taken again — when a session is finished or
 * logged whole, and when one is corrected or deleted. Every read is on the transaction's own
 * connection: a second from the pool, held across the lock, could starve it.
 */
export async function retakeSteps(
  tx: Transaction,
  caller: Caller,
  scope: StepScope | null,
): Promise<void> {
  if (scope === null || scope.entryIds.length === 0) return
  await lockSteps(tx, caller)

  const entries = await ruledEntries(tx, caller, scope.entryIds)
  if (entries.length === 0) return
  const ids = entries.map((e) => e.id)
  const [steps, sets, loadFor] = await Promise.all([
    stepsOf(tx, caller, ids),
    finishedSets(tx, caller, ids, scope.startedAt),
    loadsOf(caller.userId, caller.weightUnit, tx),
  ])

  await tx
    .delete(progressionSteps)
    .where(
      and(
        eq(progressionSteps.userId, caller.userId),
        inArray(progressionSteps.entryId, ids),
        eq(progressionSteps.kind, 'session'),
        gte(progressionSteps.takenAt, scope.startedAt),
      ),
    )

  const stepsByEntry = groupBy(steps, (s) => s.entryId)
  const setsByEntry = groupBy(sets, (s) => s.entryId)
  const taken = entries.flatMap((entry) =>
    retaken(
      entry,
      stepsByEntry.get(entry.id) ?? [],
      setsByEntry.get(entry.id) ?? [],
      scope.startedAt,
      loadFor,
    ),
  )
  if (taken.length === 0) return
  await tx
    .insert(progressionSteps)
    .values(taken.map((s) => Object.assign(s, { userId: caller.userId, kind: 'session' as const })))
}

/**
 * A target set by hand: a step of its own, dated now, anchoring every session after it. The
 * caller takes the step lock before reading what it is set from (`lockSteps`).
 *
 * Dated by `clock_timestamp()`, as it is written — never `now()`, which is when the transaction
 * BEGAN: a session logged whole in a transaction begun after it, but granted the lock first, would
 * be dated later and judged without it, and its step would overwrite the target just set.
 */
export async function writeByHand(
  tx: Transaction,
  caller: Caller,
  step: {
    readonly entryId: string
    readonly from: SetTarget
    readonly target: SetTarget
    readonly against: Against
  },
): Promise<void> {
  await tx.insert(progressionSteps).values({
    ...step,
    userId: caller.userId,
    kind: 'by_hand',
    takenAt: sql`clock_timestamp()`,
    held: null,
    streak: 0,
  })
}

/** A person's steps are taken one write at a time: a correction and a finish cannot interleave. */
export async function lockSteps(tx: Transaction, caller: Caller): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`steps:${caller.userId}`}, 0))`,
  )
}
