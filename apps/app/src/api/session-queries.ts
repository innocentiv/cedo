import { useMutationState } from '@tanstack/react-query'
import type { RestChange, SessionUpdate, SetLog, SetLogUpdate } from '@cedo/contract'
import { api } from './http.ts'
import type { QueuedSend, QueuedSet } from './pending.ts'
import { sendAgain } from './retry.ts'
import { sessionQueue, useWriteTo } from './write-to.ts'

/**
 * A session's writes — finishing, logging a set, its reserve, an undo, a past mistake fixed — and the queue its sets wait
 * in without a signal (#9). Apart from queries.ts, which holds every other read and write, because
 * these share one queue and one session.
 */

/**
 * In the session's queue: finishing waits for every set logged before it. Finishing takes the
 * session's steps, so it names the targets too (ADR-0026); a note saved refreshes them for nothing,
 * in the background — rare, and cheaper than a second hook that could be called for a finish.
 */
export const useUpdateSession = (id: string) =>
  useWriteTo(
    ['session', 'target'],
    async (input: SessionUpdate) => await api.sessions.update(id, input),
    {
      queued: { mutationKey: sessionQueue(id).update, scope: sessionQueue(id).scope },
    },
  )

/**
 * +30 s, or skip, of the rest the server keeps (#38) — in the session's queue, behind the set that
 * started it, so offline it waits with the sets and is sent after them.
 */
export const useChangeRest = (id: string) =>
  useWriteTo('session', async (input: RestChange) => await api.sessions.changeRest(id, input), {
    queued: { mutationKey: ['changeRest', id], scope: sessionQueue(id).scope },
  })

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
 * This session's sets still being sent, in the order logged, as the queue holds them — read once,
 * for `setsOfSession` (pending.ts) to work out what the workout shows of them.
 */
export const useQueuedSends = (sessionId: string): readonly QueuedSend[] =>
  useMutationState({
    filters: { mutationKey: sessionQueue(sessionId).logs, status: 'pending' },
    select: (mutation) => ({
      set: mutation.state.variables as QueuedSet | undefined,
      paused: mutation.state.isPaused,
      failures: mutation.state.failureCount,
    }),
  })

export const useRemoveLog = (sessionId: string) =>
  useWriteTo('session', async (logId: string) => await api.sessions.removeLog(sessionId, logId))

/**
 * A finished session's past mistakes fixed (#31): to the session, and to the targets its steps
 * moved, which a fix takes again (ADR-0026). Never queued: a fix is made with a signal, at leisure,
 * and said at once when refused.
 */
const PAST_FIXED = ['session', 'target'] as const

export const useCorrectSet = (sessionId: string) =>
  useWriteTo(
    PAST_FIXED,
    async ({ logId, patch }: { logId: string; patch: SetLogUpdate }) =>
      await api.sessions.amendLog(sessionId, logId, patch),
  )

export const useRemoveSet = (sessionId: string) =>
  useWriteTo(PAST_FIXED, async (logId: string) => await api.sessions.removeLog(sessionId, logId))

/** The whole session: its own reads are not asked again, being gone (`deletes`). */
export const useDeleteSession = (sessionId: string) =>
  useWriteTo(PAST_FIXED, async () => await api.sessions.remove(sessionId), {
    deletes: () => sessionId,
  })
