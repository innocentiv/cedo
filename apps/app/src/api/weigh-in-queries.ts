import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { Bodyweight, WeighInInput } from '@cedo/contract'
import { api } from './http.ts'
import { keys } from './query-client.ts'
import { useWriteTo } from './write-to.ts'

/**
 * Weigh-ins (#42): yours, or — given `athleteId` — an athlete's you coach, over the period Progress
 * shows. Taken and removed alike by either; only asked from an athlete's page while they share.
 */
export const useBodyweight = (
  athleteId: string | undefined,
  weeks: number,
): UseQueryResult<Bodyweight> =>
  useQuery({
    queryKey:
      athleteId === undefined ? keys.bodyweight(weeks) : keys.athleteBodyweight(athleteId, weeks),
    queryFn: async () => await api.weighIns.list(athleteId, { weeks }),
  })

export const useWeighIn = (athleteId?: string) =>
  useWriteTo('weighIn', async (input: WeighInInput) => await api.weighIns.create(athleteId, input))

export const useRemoveWeighIn = (athleteId?: string) =>
  useWriteTo('weighIn', async (id: string) => await api.weighIns.remove(athleteId, id))
