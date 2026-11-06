import { eq, sql } from 'drizzle-orm'
import type { SessionLogInput, WorkoutSession } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { changeIn } from './write-session.ts'
import { assertLoggable } from './loggable.ts'
import { numberedInOrder } from './numbering.ts'
import { readOwn, rethrowMissingEntry } from './service.ts'
import { assertStartable } from './start.ts'

const nowPlusMicros = (n: number) => sql<Date>`now() + ${n}::integer * interval '1 microsecond'`

/**
 * A whole, finished session in ONE transaction — `session_log` over MCP: started, then changed as
 * any session is (`changeIn`) — its sets logged and it finished at once, so it takes its steps as a
 * finish does (ADR-0026). Everything is validated before anything is written, so one bad set logs
 * nothing and a retry cannot duplicate the rest. The statement count does not grow with the number
 * of sets. Sets keep the order sent.
 */
export async function logWhole(caller: Caller, input: SessionLogInput): Promise<WorkoutSession> {
  await assertStartable(caller, input)
  await assertLoggable(caller, input.workoutId, input.sets)

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workoutSessions)
      .values({
        userId: caller.userId,
        workoutId: input.workoutId,
        dayId: input.dayId,
        notes: input.notes,
      })
      .returning({ id: workoutSessions.id })
    if (created === undefined) throw new Error('Could not record the session')
    await changeIn(tx, caller, created.id, { inProgress: true, finishes: true }, async () => {
      const rows = numberedInOrder(input.sets).map((set, i) =>
        Object.assign(set, { sessionId: created.id, loggedAt: nowPlusMicros(i) }),
      )
      await tx.insert(setLogs).values(rows).catch(rethrowMissingEntry)
      await tx
        .update(workoutSessions)
        .set({ endedAt: nowPlusMicros(input.sets.length) })
        .where(eq(workoutSessions.id, created.id))
    })
    return created.id
  })

  return await readOwn(caller, id)
}
