import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { ProgressionSuggestion, TargetByHand } from '@cedo/contract'
import { api } from './http.ts'
import { keys } from './query-client.ts'
import { useWriteTo } from './write-to.ts'

/**
 * The caller's own targets on a plan (ADR-0026): what their next session asks of each entry, beside
 * what the plan prescribes — the plan's outline and the entry editor's Your next session. Theirs
 * whoever owns the plan: a reader of it has targets too.
 */
export const useTargets = (workoutId: string): UseQueryResult<ProgressionSuggestion[]> =>
  useQuery({
    queryKey: keys.progression(workoutId),
    queryFn: async () => await api.workouts.progression(workoutId),
    enabled: workoutId !== '',
  })

/** **Change**: the caller's own target on one entry, set by hand. It moves the targets alone. */
export const useSetTarget = (workoutId: string) =>
  useWriteTo(
    'target',
    async ({ entryId, target }: { entryId: string; target: TargetByHand }) =>
      await api.workouts.setTarget(workoutId, entryId, target),
  )
