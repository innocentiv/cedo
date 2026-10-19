import { and, eq, sql } from 'drizzle-orm'
import type { PgInsertValue } from 'drizzle-orm/pg-core'
import { type LogSetInput, type SeriesMember, asSeen, nextSetIndex } from '@cedo/contract'
import type { Transaction } from '../../db/client.ts'
import { setLogs } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { planEntries } from '../workout/plan.ts'

/**
 * How the server numbers a set: within its series (GLOSSARY.md, "Series"), by the contract's
 * `nextSetIndex` — one rule for the app and for an AI, which send no number of their own.
 */

// One INSERT shares one `now()`, and `get` orders logs by `logged_at` then `set_index`, so equal
// timestamps read back interleaved — squat 1, bench 1, squat 2. `logWhole` spaces them instead.
export const nowPlusMicros = (n: number) =>
  sql<Date>`now() + ${n}::integer * interval '1 microsecond'`

/**
 * A whole session's rows, in the order sent: each set numbered within its series — a new session
 * has nothing before them — and stamped a microsecond after the last, so they read back as sent.
 */
export function numberedRows(
  sessionId: string,
  sets: readonly LogSetInput[],
): PgInsertValue<typeof setLogs>[] {
  const numbered: (SeriesMember & { setIndex: number })[] = []
  const rows: PgInsertValue<typeof setLogs>[] = []
  for (const set of sets) {
    const setIndex = nextSetIndex(numbered, set)
    numbered.push({ entryId: set.entryId, exerciseId: set.exerciseId, setIndex })
    rows.push({ ...set, sessionId, setIndex, loggedAt: nowPlusMicros(rows.length) })
  }
  return rows
}

/**
 * The number `input` takes in its series — `nextSetIndex` over the logs as the caller's series see
 * them (`asSeen`): a set whose entry is out of their reach counts as logged with none.
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
  const logged = await tx
    .select({
      entryId: setLogs.entryId,
      exerciseId: setLogs.exerciseId,
      setIndex: setLogs.setIndex,
    })
    .from(setLogs)
    .where(and(eq(setLogs.sessionId, session.id), eq(setLogs.exerciseId, input.exerciseId)))
  if (session.workoutId === null) return nextSetIndex(logged, input)

  const plan = planEntries(caller, session.workoutId)
  const reachable = await tx
    .select({ id: plan.id })
    .from(plan)
    .where(eq(plan.exerciseId, input.exerciseId))
  return nextSetIndex(asSeen(logged, new Set(reachable.map((e) => e.id))), input)
}
