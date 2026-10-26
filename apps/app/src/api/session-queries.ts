import { useMutationState } from '@tanstack/react-query'
import type { LogSetInput, SessionUpdate, SetLog, SetLogUpdate } from '@cedo/contract'
import { api } from './http.ts'
import { sendAgain } from './retry.ts'
import { sessionQueue, useWriteTo } from './write-to.ts'

/**
 * A session's writes — finishing, logging a set, its reserve, an undo, a past mistake fixed — and the queue its sets wait
 * in without a signal (#9). Apart from queries.ts, which holds every other read and write, because
 * these share one queue and one session.
 */

/** In the session's queue: finishing waits for every set logged before it. */
export const useUpdateSession = (id: string) =>
  useWriteTo('session', async (input: SessionUpdate) => await api.sessions.update(id, input), {
    queued: { mutationKey: sessionQueue(id).update, scope: sessionQueue(id).scope },
  })

/** One set, its idempotency key made once when it was logged, so every retry of it is the same. */
export interface QueuedSet {
  readonly input: LogSetInput
  readonly key: string
}

/**
 * Sent at once when there is a signal; without one, it waits in the session's queue and is sent
 * when the signal is back — again, under its key, if the answer was lost (`retry.ts`).
 */
export const useLogSet = (sessionId: string) =>
  useWriteTo(
    'session',
    async ({ input, key }: QueuedSet): Promise<SetLog> =>
      await api.sessions.logSet(sessionId, input, key),
    {
      queued: {
        mutationKey: sessionQueue(sessionId).logs,
        scope: sessionQueue(sessionId).scope,
        retry: sendAgain,
      },
    },
  )

/**
 * The sets of this session not yet sent, in the order logged — and whether any is held up: waiting
 * for a signal, or sent again after a lost answer — which is when the screen asks to stay open.
 */
export function useUnsentSets(sessionId: string): {
  readonly sets: readonly QueuedSet[]
  readonly heldUp: boolean
} {
  const pending = useMutationState({
    filters: { mutationKey: sessionQueue(sessionId).logs, status: 'pending' },
    select: (mutation) => ({
      set: mutation.state.variables as QueuedSet | undefined,
      heldUp: mutation.state.isPaused || mutation.state.failureCount > 0,
    }),
  })
  return {
    sets: pending.flatMap(({ set }) => (set === undefined ? [] : [set])),
    heldUp: pending.some((p) => p.heldUp),
  }
}

export const useRemoveLog = (sessionId: string) =>
  useWriteTo('session', async (logId: string) => await api.sessions.removeLog(sessionId, logId))

/** How hard a set was, said after it (#24): only of a set the server has. */
export const useAmendLog = (sessionId: string) =>
  useWriteTo(
    'session',
    async (input: { logId: string; rpe: number | null }) =>
      await api.sessions.amendLog(sessionId, input.logId, { rpe: input.rpe }),
  )

/**
 * A finished session's past mistakes fixed (#31): to the session, and to `pastSession` — the
 * sessions the next one's targets are carried over. Never queued: a fix is made with a signal, at
 * leisure, and said at once when refused.
 */
const FIX = ['session', 'pastSession'] as const

export const useCorrectSet = (sessionId: string) =>
  useWriteTo(
    FIX,
    async ({ logId, patch }: { logId: string; patch: SetLogUpdate }) =>
      await api.sessions.amendLog(sessionId, logId, patch),
  )

export const useRemoveSet = (sessionId: string) =>
  useWriteTo(FIX, async (logId: string) => await api.sessions.removeLog(sessionId, logId))

/** The whole session: its own reads are not asked again, being gone (`deletes`). */
export const useDeleteSession = (sessionId: string) =>
  useWriteTo(FIX, async () => await api.sessions.remove(sessionId), { deletes: () => sessionId })
