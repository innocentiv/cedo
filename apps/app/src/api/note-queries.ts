import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { AthleteNote, AthleteNoteInput } from '@cedo/contract'
import { api } from './http.ts'
import { keys } from './query-client.ts'
import { useWriteTo } from './write-to.ts'

/**
 * Athlete notes (#41): about you, or — given `athleteId` — about an athlete you coach, read and
 * written alike. Only asked from an athlete's page while they share their training.
 */
export const useNotes = (athleteId?: string): UseQueryResult<AthleteNote[]> =>
  useQuery({
    queryKey: athleteId === undefined ? keys.notes : keys.athleteNotes(athleteId),
    queryFn: async () => await api.notes.list(athleteId),
  })

export const useWriteNote = (athleteId?: string) =>
  useWriteTo('note', async (input: AthleteNoteInput) => await api.notes.create(athleteId, input))

export const useRewordNote = (athleteId?: string) =>
  useWriteTo(
    'note',
    async ({ id, text }: { readonly id: string; readonly text: string }) =>
      await api.notes.update(athleteId, id, { text }),
  )

export const useRemoveNote = (athleteId?: string) =>
  useWriteTo('note', async (id: string) => await api.notes.remove(athleteId, id))
