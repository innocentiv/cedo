import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query'
import { type Read, type Source, affectedBy } from '@cedo/contract'
import { ApiError } from './errors.ts'

/**
 * How every write in `queries.ts` is made: what it refreshes, and — for a session's writes — the
 * queue it waits in. The mechanism, apart from the catalogue of hooks screens call.
 */

/**
 * A write that may wait for a signal (#9). Writes sharing a `scope` run one at a time, in the order
 * made — so a session's sets arrive as they were logged, and its finish after them all — and wait
 * while the device is offline. `retry` is set only on a write that carries an idempotency key.
 */
export interface Queued {
  readonly mutationKey: readonly unknown[]
  readonly scope: { readonly id: string }
  readonly retry?: (failureCount: number, error: Error) => boolean
  readonly retryDelay?: (attempt: number) => number
}

/** The queue a session's writes wait in. Its key names the pending sets the screen shows. */
export const sessionQueue = (sessionId: string) => ({
  logs: ['logSet', sessionId] as const,
  scope: { id: `session-${sessionId}` },
})

/**
 * A write to `source` refreshes every read it makes stale (`affectedBy`): all copies of each,
 * whatever their arguments, since only what is mounted actually refetches. The reads OF the
 * source are awaited, because the next write reads them — the live session numbers the next set
 * from the refreshed logs. Reads that only embed it are marked stale at once and refetch behind.
 *
 * A refused write — gone, out of reach, or a conflict with what is stored — reads again what it
 * was OF, and nothing more: someone else's write may have moved the screen's picture on, and it is
 * a cheap re-read when it has not. See docs/08-frontend.md.
 *
 * Nothing reports a failure here — there is deliberately no `onError` that logs or swallows one.
 * A blanket handler cannot tell a failure nobody is watching from one a form is already showing —
 * it logged every rejected validation, including the ones `useSubmit` renders, and turned an
 * expected 422 into a failed e2e run. The rule instead: **every caller awaits `mutateAsync` inside
 * `submit()`**, so the message reaches `FormError` and, when it is not an `ApiError`, the console.
 * A bare `.mutate()` is the smell — it reads nothing back. A queued write is awaited the same way:
 * its `submit()` resolves when the set is sent, or says why it was refused.
 */
export function useWriteTo<TInput, TResult>(
  source: Source,
  run: (input: TInput) => Promise<TResult>,
  deletes?: (input: TInput) => string,
  queued?: Queued,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient()
  /**
   * Every cached read of `reads` — but none keyed by what the write deletes. `[read, id]` is the
   * thing itself: just deleted, or already gone (404), it is not asked for again by the screen
   * still showing it, which would be told it does not exist and say so on the console. Derived from
   * the key shape, not listed per delete, so a new read keyed by the id is skipped without being
   * remembered. Left to be collected once nothing shows it.
   */
  const refresh = async (reads: readonly Read[], deleted: string | undefined) => {
    await Promise.all(
      reads.map(async (read) =>
        queryClient.invalidateQueries({
          queryKey: [read],
          predicate: (query) => deleted === undefined || query.queryKey[1] !== deleted,
        }),
      ),
    )
  }
  return useMutation({
    mutationFn: run,
    ...queued,
    onSuccess: async (_result, input) => {
      const deleted = deletes?.(input)
      const { awaited, background } = affectedBy(source)
      void refresh(background, deleted)
      await refresh(awaited, deleted)
    },
    // Not awaited: the refusal reaches the form at once, and the re-read follows it.
    onError: (error, input) => {
      if (error instanceof ApiError && (error.code === 'not_found' || error.code === 'conflict')) {
        void refresh(affectedBy(source).awaited, deletes?.(input))
      }
    },
  })
}
