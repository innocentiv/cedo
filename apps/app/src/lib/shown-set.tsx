import {
  type LoggedExercise,
  type Rest,
  asksReserveOf,
  formatEffort,
  loggedLabel,
} from '@cedo/contract'
import type { PendingLog } from '../api/pending.ts'
import { LastSet, RestBand, Stack } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import type { WorkoutSets } from './workout-state.ts'
import { useWeightUnit } from './weight-unit.ts'

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
  readonly rest: Rest | null
  /** The set shown — null when there is none to show. */
  readonly children: React.JSX.Element | null
}): React.JSX.Element | null {
  if (rest === null && children === null) return null
  return (
    <Stack gap="sm">
      <RestBand rest={rest} testID="rest-band" />
      {children}
    </Stack>
  )
}

/**
 * One logged set above the focus (#24) — the one just logged, or one re-opened from its mark: what
 * it was, whether it was a personal best, its reserve — asked here, after the set, of a working set
 * the server has and that is counted in reps (`asksReserveOf`) — Undo, and "+ set" once its entry
 * has all it asked for. A set still waiting for a signal has nothing to change on it yet.
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
      effort={formatEffort(log, tracking, unit)}
      best={stored?.personalBest === true}
      waiting={sets.waiting.has(log.id)}
      reserve={
        stored === undefined || tracking === null || !asksReserveOf(stored, tracking)
          ? null
          : {
              rpe: stored.rpe,
              onChange: (rpe) => {
                sets.record.reserve(stored.id, rpe)
              },
            }
      }
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
