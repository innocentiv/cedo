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

/** A set's send as the queue holds it: the set, and how its sending stands. */
export interface QueuedSend {
  readonly set: QueuedSet | undefined
  /** Waiting for a signal — or behind a set that is. */
  readonly paused: boolean
  /** Tries that failed: an answer lost on a weak signal, sent again (`retry.ts`). */
  readonly failures: number
}

/**
 * A session's sets as the workout reads them (#9): all of them — those waiting for a signal counted
 * as done — which are waiting, and how their sending stands. Every reading of a set not yet sent is
 * worked out here, from the session's sets and the queue, each read once.
 */
export interface SessionSets {
  readonly all: readonly PendingLog[]
  /** The keys of the sets waiting to be sent: a set's id until the server gives it one. */
  readonly waiting: ReadonlySet<string>
  /** The sets not yet sent, in the order logged — shown as soon as logged: not sent is not lost. */
  readonly unsent: readonly QueuedSet[]
  /** One waits for a signal, or is sent again after a lost answer: the screen asks to stay open. */
  readonly heldUp: boolean
  /**
   * The last set's first send is on its way: the next waits for it, not behind it in the queue.
   * Not while the queue drains — the last set waits its turn, so the next is logged behind it.
   */
  readonly busy: boolean
}

/** Waiting for a signal, or sent again after a lost answer. */
const held = (send: QueuedSend): boolean => send.paused || send.failures > 0

export function setsOfSession(
  server: readonly PendingLog[],
  sends: readonly QueuedSend[],
): SessionSets {
  const unsent = sends.flatMap(({ set }) => (set === undefined ? [] : [set]))
  // In the order logged: a session's sends run one at a time, so the last waits behind the others.
  const last = sends.at(-1)
  return {
    all: withPending(server, unsent),
    waiting: new Set(unsent.map((s) => s.key)),
    unsent,
    heldUp: sends.some((send) => held(send)),
    busy: last !== undefined && !held(last),
  }
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
