import { Instance, type InstancePatch } from '@cedo/contract'
import type { Verbs } from './client.ts'

/** The instance itself (#71): read signed in or not, changed by its curator. */
export const instance = ({ GET, PATCH }: Verbs) => ({
  get: async () => await GET('/instance', Instance),
  update: async (body: InstancePatch) => await PATCH('/instance', Instance, body),
})
