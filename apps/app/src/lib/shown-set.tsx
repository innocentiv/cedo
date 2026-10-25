import { useState } from 'react'
import {
  type LoggedExercise,
  type SetLog,
  asksReserve,
  formatEffort,
  loggedLabel,
} from '@cedo/contract'
import type { PendingLog } from '../api/pending.ts'
import { LastSet } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import type { useRecordSet } from './record-set.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * Which logged set the workout shows above the focus (#24): the one just logged, unless a mark was
 * tapped to re-open another — which holds until the next set is logged, as every choice on the
 * screen does. The key is `<entry>:<set>`, as the marks name a set.
 */
export function useShown(latest: string | null): {
  readonly key: string | null
  readonly select: (key: string) => void
} {
  const [chosen, setChosen] = useState<{ readonly key: string; readonly at: string | null }>()
  return {
    key: chosen?.at === latest ? chosen.key : null,
    select: (key) => {
      setChosen({ key, at: latest })
    },
  }
}

/**
 * One logged set: what it was, whether it was a personal best, its reserve — asked here, after the
 * set, and only of a set the server has and that is counted in reps — and Undo. A set still
 * waiting for a signal has nothing to change on it yet.
 */
export function ShownSet({
  log,
  exercise,
  serverLogs,
  waiting,
  record,
  onUndo,
}: {
  readonly log: PendingLog | null
  readonly exercise: LoggedExercise | null
  readonly serverLogs: readonly SetLog[]
  readonly waiting: ReadonlySet<string>
  readonly record: ReturnType<typeof useRecordSet>
  readonly onUndo: (logId: string) => void
}): React.JSX.Element | null {
  const unit = useWeightUnit()
  if (log === null) return null
  const stored = serverLogs.find((l) => l.id === log.id)
  const tracking = exercise?.tracking ?? null
  const which = stored === undefined ? 'set' : loggedLabel(stored, serverLogs)
  return (
    <LastSet
      title={`${exerciseName(exercise)} · ${which}`}
      effort={formatEffort(log, tracking, unit)}
      best={stored?.personalBest === true}
      waiting={waiting.has(log.id)}
      reserve={
        stored === undefined || log.isWarmup || tracking === null || !asksReserve(tracking)
          ? null
          : {
              rpe: stored.rpe,
              onChange: (rpe) => {
                record.reserve(stored.id, rpe)
              },
            }
      }
      onUndo={
        stored === undefined
          ? null
          : () => {
              onUndo(stored.id)
            }
      }
      testID="last-set"
    />
  )
}
