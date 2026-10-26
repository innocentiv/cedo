import type { FlowLog, LogSetInput } from '@cedo/contract'

/**
 * A set as the workout's flow reads it, with the exercise it is of: a set of a session without a
 * plan has no entry to say it.
 */
/** A set as the screen shows it: its reserve too, said before it was logged (#37). */
export type PendingLog = FlowLog & { readonly exerciseId: string; readonly rpe: number | null }

/**
 * Sets logged but not yet sent (#9), as the workout screen's flow reads them (#24): done. Logged
 * without a signal, the next set must still come up and rest still start — the athlete is between
 * sets either way — while the server holds none of them yet.
 *
 * Each is dated after every set the server has: a server clock ahead of the device would otherwise
 * date a set logged now BEFORE the last one it stored, and the focus would go back to it. App-owned
 * state with no React in it, so tested beside it — see CLAUDE.md, invariant 7.
 */
export function withPending(
  logs: readonly PendingLog[],
  unsent: readonly { readonly input: LogSetInput; readonly key: string }[],
  now: number,
): PendingLog[] {
  const latest = logs.reduce((at, l) => Math.max(at, Date.parse(l.loggedAt)), 0)
  const from = Math.max(now, latest + 1)
  return [
    ...logs,
    ...unsent.map(({ input, key }, i) => ({
      id: key,
      exerciseId: input.exerciseId,
      entryId: input.entryId,
      isWarmup: input.isWarmup,
      loggedAt: new Date(from + i).toISOString(),
      reps: input.reps,
      weightG: input.weightG,
      durationS: input.durationS,
      distanceMm: input.distanceMm,
      rpe: input.rpe,
    })),
  ]
}
