import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { AthleteEquipmentInput, OfAthlete } from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import * as CoachingService from '../../modules/coaching/service.ts'
import * as EquipmentService from '../../modules/equipment/service.ts'
import { text } from '../format.ts'
import { equipmentLines } from '../format-library.ts'

const READ = { readOnlyHint: true, openWorldHint: false } as const
/** It replaces the setup whole — but it is the person's own setting, said again as often as asked. */
const SETTING = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

/**
 * What someone has to train with (#34), so a plan asks only for what their gym has. Your own is
 * read and said; an athlete's is read, never changed.
 */
export function registerEquipmentTools(server: McpServer, caller: Caller): void {
  server.registerTool(
    'equipment_get',
    {
      title: 'What you have to train with',
      description:
        'The equipment you — or an athlete, with `athlete` — have, an item a line, and for one ' +
        'that holds the load how its weights go. Read it BEFORE planning: an exercise needs ' +
        'every item exercise_get lists as `needs`. "Not described yet" means nothing is known, ' +
        'not that nothing is there.',
      inputSchema: z.object({}).safeExtend(OfAthlete.shape),
      annotations: READ,
    },
    async ({ athlete }) =>
      text(equipmentLines(await CoachingService.equipment(caller, athlete), caller.weightUnit)),
  )

  server.registerTool(
    'equipment_set',
    {
      title: 'Say what you have to train with',
      description:
        'Replace what you have to train with, WHOLE: list every item, since what is left out ' +
        'you do not have. Weights in GRAMS — "dumbbells from 2 to 30 kg, 2 kg apart" is ' +
        '{ minG: 2000, stepG: 2000, maxG: 30000 }; a barbell starts from the bar. Your own only.',
      inputSchema: AthleteEquipmentInput,
      annotations: SETTING,
    },
    async (input) =>
      text(
        `Saved.\n\n${equipmentLines(await EquipmentService.replace(caller, input), caller.weightUnit)}`,
      ),
  )
}
