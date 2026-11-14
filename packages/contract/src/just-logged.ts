import type { Effort } from './effort.ts'
import { type TrackingMode, exerciseName } from './exercise.ts'
import type { SeriesMember } from './log.ts'
import { type RestHeld, extensionsOf } from './rest-held.ts'
import { type RestAfter, type RestPhase, type SessionRest, chimesAtEnd, restPhase } from './rest.ts'
import { formatWithReserve } from './rpe.ts'
import { loggedLabel } from './set-marks.ts'
import type { WeightUnit } from './units.ts'

/**
 * What stands in Log's place once a set is logged (#63; GLOSSARY.md, "Just logged"): of the set
 * `workoutView` shows and its rest, with what the phone holds of that rest (`rest-held.ts`) and what
 * the server keeps of it — the rest running, Undo beside Log, or nothing: Log alone. Pure, so the
 * screen only draws it and keeps the clock; see docs/08-frontend.md, "The workout screen".
 */

/** The set just logged, as Log's place shows it. */
interface JustLoggedSet<S> {
  /** Seconds of its rest still to run — or null: none runs, and Log stays, beside Undo. */
  readonly restLeft: number | null
  /** The set as the server has it, for Undo to take back — null while it waits for a signal. */
  readonly stored: S | null
  /** `Bench Press · set 2` — or `· set`, of one the server has not numbered yet. */
  readonly title: string
  /** What it said: `8 × 60 kg · 2 in reserve`. */
  readonly effort: string
  readonly best: boolean
  /** Not sent yet: there is nothing on the server to take back. */
  readonly waiting: boolean
}

/** Log's place, decided: `justLogged`'s answer. */
export interface LogsPlace<S> {
  /** Where the rest stands (`restPhase`): what an alert set on this phone follows too (#39). */
  readonly phase: RestPhase
  /** The rest seen running here has just run out: its end chimes (`chimesAtEnd`). */
  readonly chimes: boolean
  /** The set just logged — or null: before the first, after an undo, and once its rest is over. */
  readonly set: JustLoggedSet<S> | null
}

/**
 * What stands in Log's place, `now`.
 *
 * The set just logged is the one shown, while it can still be taken back where it was logged: while
 * its rest runs — with this phone's +30 s taps and skip, each read by its own rest alone — or, with no
 * rest after it, until the next set. Once the rest is over none of it is shown. A set still waiting
 * for a signal is one the `server` does not have: it has no Undo, and no number yet.
 */
export function justLogged<
  S extends SeriesMember & {
    readonly id: string
    readonly isWarmup: boolean
    readonly personalBest: boolean
  },
>({
  shown,
  rest,
  server,
  held,
  kept,
  unit,
  now,
}: {
  /** The set shown, and its rest: `workoutView`'s. */
  readonly shown: {
    readonly log: Effort & { readonly id: string; readonly reserve: number | null }
    readonly exercise: { readonly name: string; readonly tracking: TrackingMode } | null
  } | null
  readonly rest: RestAfter | null
  /** The session's sets as the server has them. */
  readonly server: readonly S[]
  readonly held: RestHeld
  /** The same rest as the server keeps it (#38): a tap elsewhere, or before a reload, is in it. */
  readonly kept: SessionRest | null
  readonly unit: WeightUnit
  readonly now: number
}): LogsPlace<S> {
  const after = rest?.after ?? null
  // Each tap is read by the rest it was made on: the next set's starts with none of them.
  const extensions = after === null ? 0 : extensionsOf(held, after)
  const phase = restPhase(rest, extensions, kept, after !== null && held.skipped === after, now)
  const chimes = chimesAtEnd(held.seen, after, phase)
  if (shown === null || phase.phase === 'over') return { phase, chimes, set: null }
  const { log, exercise } = shown
  const stored = server.find((s) => s.id === log.id) ?? null
  return {
    phase,
    chimes,
    set: {
      restLeft: phase.phase === 'running' ? phase.left : null,
      stored,
      title: `${exerciseName(exercise)} · ${stored === null ? 'set' : loggedLabel(stored, server)}`,
      effort: formatWithReserve(log, exercise?.tracking ?? null, unit),
      best: stored?.personalBest === true,
      waiting: stored === null,
    },
  }
}
