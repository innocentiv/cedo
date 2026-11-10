import { Elysia } from 'elysia'
import { z } from 'zod'
import { AthleteEquipment, AthleteEquipmentInput, Id } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { own, ownOrCoached } from '../coaching/training.ts'
import * as EquipmentService from './service.ts'

/**
 * Your own equipment (#34). An athlete's, read by their coach, is `/athletes/:id/equipment`.
 */
export const equipmentRoutes = new Elysia({ prefix: '/equipment', tags: ['equipment'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/',
    {
      response: AthleteEquipment,
      detail: { summary: 'What you have to train with, and how its weights go' },
    },
    ({ caller }) => EquipmentService.read(own(caller)),
  )
  .put(
    '/',
    {
      body: AthleteEquipmentInput,
      response: AthleteEquipment,
      detail: { summary: 'Say what you have to train with, all of it, replacing what was said' },
    },
    ({ caller, body }) => EquipmentService.replace(caller, body),
  )

/** An athlete's equipment, read by their coach (#34) — and changed by none of them. */
export const athleteEquipmentRoutes = new Elysia({ prefix: '/athletes', tags: ['coaching'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/:id/equipment',
    {
      params: z.object({ id: Id }),
      response: AthleteEquipment,
      detail: { summary: 'What an athlete has to train with, and how its weights go (#34)' },
    },
    async ({ caller, params: { id } }) =>
      await EquipmentService.read(await ownOrCoached(caller, id)),
  )
