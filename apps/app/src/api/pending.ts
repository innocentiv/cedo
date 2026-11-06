import type { FlowLog, LogSetInput, SetLog } from '@cedo/contract'

/**
 * A set as the workout's flow reads it, with the exercise it is of — a set of a session without a
 * plan has no entry to say it — and its reserve, said before it was logged (#37).
 */
export type PendingLog = FlowLog & Pick<SetLog, 'exerciseId' | 'reserve'>

/**
 * One set logged, as it waits to be sent (#9): its idempotency key and its time, both made once
 * when it was logged, so every retry of it is the same set — and its rest counts from when it was
 * lifted, however often it is read. The server dates it when it arrives.
 */
export interface QueuedSet {
  readonly input: LogSetInput
  readonly key: string
  /** The device's clock when it was logged. */
  readonly loggedAt: string
}

/**
 * Sets logged but not yet sent (#9), as the workout screen's flow reads them (#24): done. Logged
 * without a signal, the next set must still come up and rest still start — the athlete is between
 * sets either way — while the server holds none of them yet.
 *
 * Each is dated when it was logged, but after every set before it: a server clock ahead of the
 * device would otherwise date a set logged now BEFORE the last one it stored, and the focus would
 * go back to it. App-owned state with no React in it, so tested beside it — see CLAUDE.md,
 * invariant 7.
 */
export function withPending(
  logs: readonly PendingLog[],
  unsent: readonly QueuedSet[],
): PendingLog[] {
  let after = logs.reduce((at, l) => Math.max(at, Date.parse(l.loggedAt)), 0)
  const waiting: PendingLog[] = []
  for (const { input, key, loggedAt } of unsent) {
    after = Math.max(Date.parse(loggedAt), after + 1)
    waiting.push({
      id: key,
      exerciseId: input.exerciseId,
      entryId: input.entryId,
      isWarmup: input.isWarmup,
      loggedAt: new Date(after).toISOString(),
      reps: input.reps,
      weightG: input.weightG,
      durationS: input.durationS,
      distanceMm: input.distanceMm,
      reserve: input.reserve,
    })
  }
  return [...logs, ...waiting]
}
