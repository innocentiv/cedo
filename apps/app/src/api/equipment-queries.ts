import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { AthleteEquipment, AthleteEquipmentInput } from '@cedo/contract'
import { api } from './http.ts'
import { keys } from './query-client.ts'
import { useWriteTo } from './write-to.ts'

/** What you have to train with (#34), and saying it — replaced whole. */
export const useEquipment = (): UseQueryResult<AthleteEquipment> =>
  useQuery({ queryKey: keys.equipment, queryFn: async () => await api.equipment.get() })

export const useSaveEquipment = () =>
  useWriteTo('equipment', async (input: AthleteEquipmentInput) => await api.equipment.save(input))

/**
 * An athlete's, read by their coach — never changed here. Asked only from their page's shared
 * contents, so only while they share their training.
 */
export const useAthleteEquipment = (id: string): UseQueryResult<AthleteEquipment> =>
  useQuery({
    queryKey: keys.athleteEquipment(id),
    queryFn: async () => await api.athletes.equipment(id),
  })
