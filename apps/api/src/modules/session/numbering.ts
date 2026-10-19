import { and, eq } from 'drizzle-orm'
import { type LogSetInput, MAX_SET_INDEX, nextSetIndex } from '@cedo/contract'
import type { Transaction } from '../../db/client.ts'
import { setLogs } from '../../db/schema.ts'
import { invalid } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { planEntries } from '../workout/plan.ts'

/**
 * How the server numbers a set: within its series (GLOSSARY.md, "Series"), by the contract's
 * `nextSetIndex` — one rule for the app and for an AI, which send no number of their own.
 */

/** A series holds at most `MAX_SET_INDEX + 1` sets; the next past that is refused, not stored. */
function checked(next: number): number {
  if (next > MAX_SET_INDEX) throw invalid(`A series holds at most ${MAX_SET_INDEX + 1} sets`)
  return next
}

/** A whole new session's sets, each numbered within its series in the order sent. */
export function numberedInOrder(
  sets: readonly LogSetInput[],
): (LogSetInput & { setIndex: number })[] {
  const numbered: (LogSetInput & { setIndex: number })[] = []
  for (const set of sets) numbered.push({ ...set, setIndex: checked(nextSetIndex(numbered, set)) })
  return numbered
}

/**
 * The number `input` takes in its series, over the logs as the caller sees them: each with its plan
 * entry only while that entry is in the session's plan and within reach — a LEFT JOIN onto
 * `planEntries`, the same one the session read uses, so the screen's "N done" and this number
 * cannot disagree. A set whose entry is gone or out of reach counts as logged with none.
 *
 * Called under the session's row lock, which is what keeps a number unique: two devices logging at
 * once are serialised there. Only this exercise's logs are read — a series never spans exercises,
 * because an entry's exercise is fixed (`assertLoggable` refuses a set naming another, and a plan
 * save turns a changed exercise into a new entry).
 */
export async function nextNumber(
  tx: Transaction,
  caller: Caller,
  session: { readonly id: string; readonly workoutId: string | null },
  input: LogSetInput,
): Promise<number> {
  const plan = planEntries(caller, session.workoutId)
  const logged = await tx
    .select({ entryId: plan.id, exerciseId: setLogs.exerciseId, setIndex: setLogs.setIndex })
    .from(setLogs)
    .leftJoin(plan, eq(plan.id, setLogs.entryId))
    .where(and(eq(setLogs.sessionId, session.id), eq(setLogs.exerciseId, input.exerciseId)))
  return checked(nextSetIndex(logged, input))
}
