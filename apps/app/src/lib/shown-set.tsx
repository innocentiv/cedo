import {
  type LoggedExercise,
  type Rest,
  type SessionRest,
  formatWithReserve,
  loggedLabel,
} from '@cedo/contract'
import type { PendingLog } from '../api/pending.ts'
import { useChangeRest } from '../api/session-queries.ts'
import { LastSet, RestBand, Stack } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import type { WorkoutSets } from './workout-state.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * The rest after the latest set (#24): as the sets say it (`restOf`) — sets waiting for a signal
 * too — and as the server keeps it (#38), with the session it is told to.
 */
export interface RestShown {
  readonly rest: Rest | null
  readonly kept: SessionRest | null
  readonly sessionId: string
}

/** A set re-opened from its mark: of a plan entry, or of an exercise logged with none. */
export interface Reopened {
  readonly entryId: string | null
  readonly exerciseId: string
  /** The set's key among its entry's — or exercise's — sets (`SessionSet.key`). */
  readonly key: string
}

/**
 * What was just done, as one group above the focus (#24 review): the rest it started, then the set.
 * Nothing, before the first set.
 */
export function JustDone({
  rest,
  children,
}: {
  readonly rest: RestShown
  /** The set shown — null when there is none to show. */
  readonly children: React.JSX.Element | null
}): React.JSX.Element | null {
  const tell = useChangeRest(rest.sessionId)
  if (rest.rest === null && children === null) return null
  return (
    <Stack gap="sm">
      <RestBand
        rest={rest.rest}
        kept={rest.kept}
        onChange={(change) => {
          // In the session's queue; refused, the rest the server keeps stays as it was.
          tell.mutate(change)
        }}
        testID="rest-band"
      />
      {children}
    </Stack>
  )
}

/**
 * One logged set above the focus (#24) — the one just logged, or one re-opened from its mark: what
 * it was, with its reserve, said before logging it (#37) — whether it was a personal best, Undo, and
 * "+ set" once its entry has all it asked for. A set still waiting for a signal has nothing to
 * change on it yet.
 */
export function ShownSet({
  log,
  exercise,
  sets,
  onAnother,
}: {
  readonly log: PendingLog | null
  readonly exercise: LoggedExercise | null
  readonly sets: WorkoutSets
  readonly onAnother?: (() => void) | undefined
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  if (log === null) return null
  const stored = sets.server.find((l) => l.id === log.id)
  const tracking = exercise?.tracking ?? null
  return (
    <LastSet
      title={`${exerciseName(exercise)} · ${stored === undefined ? 'set' : loggedLabel(stored, sets.server)}`}
      effort={formatWithReserve(log, tracking, unit)}
      best={stored?.personalBest === true}
      waiting={sets.waiting.has(log.id)}
      onUndo={
        stored === undefined
          ? null
          : () => {
              sets.undo(stored.id)
            }
      }
      onAnother={onAnother}
      testID="last-set"
    />
  )
}
