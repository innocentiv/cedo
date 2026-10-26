import { Elysia } from 'elysia'
import { AthleteEquipment, AthleteEquipmentInput } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { own } from '../session/service.ts'
import * as EquipmentService from './service.ts'

/**
 * Your own equipment (#34). An athlete's, read by their coach, is `/athletes/:id/equipment`.
 */
export const equipmentRoutes = new Elysia({ prefix: '/equipment', tags: ['equipment'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller }) => EquipmentService.read(own(caller)), {
    response: AthleteEquipment,
    detail: { summary: 'What you have to train with, and how its weights go' },
  })
  .put('/', ({ caller, body }) => EquipmentService.replace(caller, body), {
    body: AthleteEquipmentInput,
    response: AthleteEquipment,
    detail: { summary: 'Say what you have to train with, all of it, replacing what was said' },
  })
